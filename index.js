import express from 'express'
import session from 'express-session';
import exphbs from 'express-handlebars';
import pool from './vendor/db.js'
import Handlebars from 'handlebars';
import moment from 'moment';
import path, { dirname } from 'path';
import serveStatic from 'serve-static';
import { fileURLToPath } from 'url';
import {mlog,say} from './vendor/logs.js'
import { get_filtered_orders } from './vendor/db.js';


import {get_username,insert_user,get_zakaz,submit_order,get_all_orders,update_status} from './vendor/db.js'

const app = express()

export async function checkConnection() {
  try {
    const connection = await pool.getConnection();
    mlog('Успешное подключение к БД');
    connection.release();
  } catch (err) {
    console.error('Ошибка подключения к БД:', err);
  }
}


const __dirname = dirname(fileURLToPath(import.meta.url));

const hbs = exphbs.create({
  defaultLayout: 'main',
  extname: 'hbs',
});
app.use(
  session({
    secret: process.env.LEGACY_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }, // change to true when using HTTPS
  }),
);

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', 'views');
app.use(express.urlencoded({ extended: true }));
app.use('/static', serveStatic(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('auth', {
    user: req.session.user,
  });
});

app.get('/reg', (req, res) => {
  res.render('reg');
});

// app.post('/register', async (req, res) => {
//   const { username, password } = req.body;

//   const result = await get_username(username);
//   if (result) {
//     const [rows] = result;
//     if (rows && rows.length > 0) {
//       res.send('Пользователь с таким username уже существует');
//     } else {
//       await insert_user(username,password,0,);
//       res.redirect('/');
//     }
//   } else {
//     // Обработка ошибки, если get_username(username) возвращает undefined
//     console.error('Ошибка при получении пользователя');
//   }
// });

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await get_username(username);
    if (result && result.length > 0) {
      res.json({ status: 'error', message: 'Пользователь с таким username уже существует' });
    } else {
      await insert_user(username, password, 0);
      res.json({ status: 'ok' });
    }
  } catch (error) {
    console.error('Ошибка при получении пользователя', error);
    res.status(500).json({ status: 'error', message: 'Ошибка при регистрации' });
  }
});


// app.post('/myzakaz', async (req, res) => {
//   const { username, password } = req.body;
//   mlog(username, password);
//   const rows = await get_username(username);

//   if (rows.length > 0) {
//     const user = rows[0];

//     if (password === user.password) {
//       req.session.userId = user.id; // сохраняем userId в сессии
//       req.session.user = user; // сохраняем всего пользователя в сессии

//       // Проверяем роль пользователя и рендерим соответствующую страницу
//       if (user.admin === 1) {
//         res.render('adminZakaz.hbs', { user: user });
//       } else {
//         res.render('newZakaz.hbs', { user: user });
//       }
//     } else {
//       res.send('Неверный пароль');
//     }
//   } else {
//     res.send('Пользователь с таким username не найден');
//   }
// });

app.post('/myzakaz', async (req, res) => {
  const { username, password } = req.body;
  const rows = await get_username(username);

  if (rows.length > 0) {
    const user = rows[0];

    if (password === user.password) {
      req.session.userId = user.id;
      req.session.user = user;

      const redirectUrl = user.admin === 1 ? '/adminZakaz' : '/newZakaz';
      res.json({ status: 'ok', redirectUrl });
    } else {
      res.json({ status: 'error', message: 'Неверный пароль' });
    }
  } else {
    res.json({ status: 'error', message: 'Пользователь с таким username не найден' });
  }
});

// выход из системы
app.get('/logout', (req, res) => {
  // Удаляем данные сессии
  req.session.destroy((err) => {
    if (err) {
      console.error('Ошибка при выходе из системы:', err);
      res.redirect('/'); // Если произошла ошибка, перенаправляем пользователя на главную страницу
    } else {
      // После успешного выхода из системы перенаправляем пользователя на страницу авторизации
      res.redirect('/');
    }
  });
});

// добавление нового заказа
// Добавляем маршрут для страницы добавления нового заказа
app.get('/newzakaz', (req, res) => {
  res.render('newZakaz.hbs', {
    user: req.session.user,
  }); // Рендерим страницу newZakaz.hbs при обращении к /newzakaz
});

app.get('/myzakaz', async (req, res) => {
  try {
    const userId = req.session.user.id; // Получение идентификатора текущего пользователя

    // const query = 'SELECT * FROM orders WHERE UserID = ?';
    const rows = await get_zakaz(userId)

    res.render('myzakaz.hbs', {
      user: req.session.user,
      orders: rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

// app.get('/myzakaz', async (req, res) => {
//   try {
//     const userId = req.session.user.id; // Получение идентификатора текущего пользователя
//     console.log('User ID:', userId); // Логирование ID пользователя
//     console.log('User admin status:', req.session.user.admin); // Логирование статуса администратора

//     const rows = await get_zakaz(userId)
//     console.log('Orders:', rows); // Логирование заказов

//     // Проверка роли пользователя
//     if (req.session.user === '1') {
//       // Если пользователь - админ
//       res.render('adminZakaz.hbs', {
//         user: req.session.user,
//         orders: rows,
//       });
//     } else {
//       // Если пользователь - обычный пользователь
//       res.render('newZakaz.hbs', {
//         user: req.session.user,
//         orders: rows,
//       });
//     }
//   } catch (error) {
//     console.error(error);
//     res.status(500).send('Internal Server Error');
//   }
// });



Handlebars.registerHelper('dateFormat', function (value) {
  return moment(value).format('DD/MM/YYYY ');
});

Handlebars.registerHelper('eq', function (a, b) {
  return a === b;
});

app.post('/submit-order', async (req, res) => {
  const order = req.body;

  // Получение userId из сессии
  const userId = req.session.userId;

  if (userId) {
    try {
      await submit_order(pool, order, userId);
      mlog('Заказ успешно отправлен!');
      res.send('ok')
    } catch (error) {
      res.status(500).json({ status: 'error', message: 'Ошибка при отправке заказа' }); // Отправьте статус ошибки и сообщение об ошибке в ответе
    }
  } else {
    res.status(400).json({ status: 'error', message: 'Ошибка: userId не определен' }); // Отправьте статус ошибки и сообщение об ошибке в ответе
  }
});




app.get('/adminzakaz', async (req, res) => {
  if (req.session.user && req.session.user.admin) {
    const statusFilter = req.query.status || ''; // Получаем фильтр из параметров запроса
    const orders = statusFilter
      ? await get_filtered_orders(statusFilter)
      : await get_all_orders();

    res.render('adminZakaz', { title: 'Admin Orders', user: req.session.user, orders });
  } else {
    res.redirect('/');
  }
});


app.post('/update-status', async (req, res) => {
  if (req.session.user && req.session.user.admin) {
    const status = req.body.status;
    const orderId = req.body.orderId;

    // Обновите статус в базе данных
    // Здесь вы бы использовали свое соединение с базой данных
    await update_status(status, orderId);

    res.redirect('/adminzakaz');
  } else {
    res.redirect('/');
  }
});


// Добавьте этот маршрут в index.js
app.get('/filter-orders', async (req, res) => {
  const { status } = req.query; // Получение значения статуса из запроса
  const userId = req.session.user.id;

  let rows;
  if (status === 'all') {
    rows = await get_zakaz(userId); // Получение всех заказов для пользователя
  } else {
    rows = await get_filtered_orders(userId, status); // Получение заказов по конкретному статусу
  }

  res.render('myzakaz.hbs', {
    user: req.session.user,
    orders: rows,
  });
});

app.listen(3000, async () => {
  mlog('Сервер был запущен...');
  await checkConnection();
});
