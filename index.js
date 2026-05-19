import {mlog} from './vendor/logs.js'
console.log(`Current directory: ${process.cwd()}`);
mlog(`Current directory: ${process.cwd()}`);

import express from 'express'
import exphbs from 'express-handlebars'
import mysql from 'mysql2/promise';
import passport from 'passport'
import expressSession from 'express-session'

import { fileURLToPath } from 'url';
import { dirname } from 'path';

import bodyParser from 'body-parser';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env') });

import {register,login,view,find,form,create,edit,update,deleteUser,viewarchive,vieworder,myorders,findOrders,manageOrders,updateOrderStatus,formOrder,createOrder,editOrder,updateOrder,editOrderAdmin,updateOrderAdmin,deleteOrder} from './vendor/db.js'

const app = express();
app.use(expressSession({
    secret: process.env.SESSION_SECRET || 'change-me-in-env',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());
const port = process.env.PORT || 5000;

// parsing middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

import { body, validationResult } from 'express-validator';

//static stuff
app.use(express.static('public'));

//templating engine
const hbs = exphbs.create({
    extname: '.hbs',
    helpers: {
        eq: function (v1, v2) {
            return v1 === v2;
        },
        formatDate: function (dateString) {
            if (!dateString) {
                return ''; 
            }
            let date = new Date(dateString);
            let day = date.getDate();
            let month = date.getMonth() + 1;
            let year = date.getFullYear();
            day = day < 10 ? '0' + day : day;
            month = month < 10 ? '0' + month : month;
            return `${year}-${month}-${day}`;
        },
        
    },
});

hbs.handlebars.registerHelper('ifeq', function(a, b, options) {
    if (a == b) {
      return options.fn(this);
    }
    return options.inverse(this);
  });

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views','views');

//connection pool
export const pool = mysql.createPool({
    connectionLimit : 100,
    host            : process.env.host,
    port            : Number(process.env.DB_PORT) || 3407,
    user            : process.env.user,
    password        : process.env.password,
    database        : process.env.database
});

//connect to db
pool.getConnection((err, connection) => {
    if(err) {
        console.error('Error connecting to the database: ', err);
        mlog('Error connecting to the database: ', err);
        return;
    }
    console.log('Connected as ID' + connection.threadId);
    mlog('Connected as ID' + connection.threadId);
});

//is auth
app.use((req, res, next) => {
    res.locals.isAuthenticated = req.session.user ? true : false;
    console.log('isAuthenticated:', res.locals.isAuthenticated);
    mlog('isAuthenticated:', res.locals.isAuthenticated);
    next();
});

export function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login');
}

export function ensureAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.is_admin) {
        console.log('User is admin');
        mlog('User is admin');
        return next();
    }
    res.redirect('/not-authorized');
}

export function ensureUser(req, res, next) {
    if (req.session && req.session.user && req.session.user.is_admin === 0) {
        return next();
    }
    res.redirect('/not-authorized');
}

//function for redirecting when somebody tries to access register or login pages while being authorized
function redirectIfAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        res.redirect('/');
    } else {
        next();
    }
}

// routes

app.get('/', (req, res) => {
    res.render('welcome', { title: 'Главная страница', user: req.session.user });
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'purchase-service' });
});

app.get('/register', redirectIfAuthenticated, (req, res) => {
    res.render('register', { title: 'Регистрация' });
});

app.post('/register',
    body('name').matches(/^[А-Яа-яA-Za-z]+$/).withMessage('Имя должно содержать только буквы!'),
    body('surname').matches(/^[А-Яа-яA-Za-z]+$/).withMessage('Фамилия должна содержать только буквы!'),
    body('patname').matches(/^[А-Яа-яA-Za-z]+$/).withMessage('Отчество должно содержать только буквы!'),
    body('email').isLength({ min: 6, max: 15 }).withMessage('Логин должен содержать от 6 до 15 символов!'),
    body('password').isLength({ min: 6, max: 30 }).withMessage('Пароль должен содержать от 6 до 30 символов!'),
    async (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            const errorMsg = errors.array().map(e => e.msg).join(' ');

            return res.render('register', {
                title: 'Регистрация',
                alert: errorMsg
            });
        }

        try {
            await register(req, res);
        } catch (err) {
            console.log(err);
            mlog(err);
            res.status(500).render('register', {
                title: 'Регистрация',
                alert: 'Ошибка сервера.'
            });
        }
    });



app.get('/login', redirectIfAuthenticated, (req, res) => {
    res.render('login', { title: 'Вход' });
});

app.post('/login',
    body('password').isLength({ min: 6 }).withMessage('Пароль должен содержать не менее 6 символов!'),
    (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            const errorMsg = errors.array().map(e => e.msg).join(' ');

            return res.render('login', {
                title: 'Вход',
                alert: errorMsg
            });
        }

        login(req, res);
    });


app.get('/logout', (req, res) => {
    req.session.destroy(function(err) {
        if (err) {
            console.log(err);
            mlog(err);
        } else {
            res.redirect('/login');
        }
    });
});

app.get('/dashboard', ensureAuthenticated, ensureAdmin, view);
app.post('/dashboard', ensureAuthenticated, ensureAdmin, find);
app.get('/dashboard/adduser', ensureAuthenticated, ensureAdmin, form);
app.post('/dashboard/adduser', 
    ensureAuthenticated, 
    ensureAdmin,
    body('name').matches(/^[А-Яа-яA-Za-z]+$/).withMessage('Имя должно содержать только буквы!'),
    body('surname').matches(/^[А-Яа-яA-Za-z]+$/).withMessage('Фамилия должна содержать только буквы!'),
    body('patname').matches(/^[А-Яа-яA-Za-z]+$/).withMessage('Отчество должно содержать только буквы!'),
    body('email').isLength({ min: 6, max: 15 }).withMessage('Логин должен содержать от 6 до 15 символов!'),
    body('password').isLength({ min: 6, max: 30 }).withMessage('Пароль должен содержать от 6 до 30 символов!'),
    async (req, res) => {
        const { surname, name, patname, email, password } = req.body;

        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            const errorMsg = errors.array().map(e => e.msg).join(' ');

            return res.render('add-user', {
                title: 'Создание пользователя',
                id: req.params.id,
                alert: errorMsg,
                isAuthenticated: req.session.isAuthenticated,
                user: req.session.user,
                surname, name, patname, email
            });
        }


        try {
            await create(req, res, errors);
        } catch (err) {
            console.log(err);
            mlog(err);
            res.status(500).render('add-user', {
                title: 'Создание пользователя',
                alert: 'Ошибка сервера.'
            });
        }
    });

app.get('/dashboard/edituser/:id', ensureAuthenticated, ensureAdmin, edit);
app.post('/dashboard/edituser/:id', 
    ensureAuthenticated, 
    ensureAdmin,
    body('name').matches(/^[А-Яа-яA-Za-z]+$/).withMessage('Имя должно содержать только буквы!'),
    body('surname').matches(/^[А-Яа-яA-Za-z]+$/).withMessage('Фамилия должна содержать только буквы!'),
    body('patname').matches(/^[А-Яа-яA-Za-z]+$/).withMessage('Отчество должно содержать только буквы!'),
    body('email').isLength({ min: 6, max: 15 }).withMessage('Логин должен содержать от 6 до 15 символов!'),
    body('password').isLength({ min: 6, max: 30 }).withMessage('Пароль должен содержать от 6 до 30 символов!'),
    async (req, res) => {
        const { surname, name, patname, email, password } = req.body;

        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            const errorMsg = errors.array().map(e => e.msg).join(' ');
            
            return res.render('edit-user', {
                title: 'Редактирование пользователя',
                alert: errorMsg,
                rows: [{
                    id: req.params.id,
                    surname, name, patname, email, password
                }],
                isAuthenticated: req.session.isAuthenticated,
                user: req.session.user
            });
        }
               

        try {
            await update(req, res);
        } catch (err) {
            console.log(err);
            mlog(err);
            res.status(500).render('edit-user', {
                title: 'Редактирование пользователя',
                alert: 'Ошибка сервера.'
            });
        }
    });

app.get('/dashboard/vieworder/:id', ensureAuthenticated, ensureAdmin, vieworder);
app.get('/dashboard/:id', ensureAuthenticated, ensureAdmin, deleteUser);

app.get('/ordersarchive', ensureAuthenticated, ensureAdmin, viewarchive);

app.get('/manageorders', ensureAuthenticated, ensureAdmin, manageOrders);
app.get('/manageorders/editorderadmin/:id', ensureAuthenticated, ensureAdmin, editOrderAdmin);
app.post('/manageorders/editorderadmin/:id', ensureAuthenticated, ensureAdmin,
    body('quantity').isInt({ min: 1, max: 500 }).withMessage('Заказать можно от 1 до 500 единиц товара!'),
    body('price').isFloat({ min: 1, max: 1000000 }).withMessage('Стоимость может принимать только численные значения!'),
    body('link').isURL().withMessage('Некорректный формат ссылки!'),
    (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            const errorMsg = errors.array().map(e => e.msg).join(' ');
        
            return res.render('edit-order-admin', {
                title: 'Изменение заказа',
                alert: errorMsg,
                isAuthenticated: req.session.isAuthenticated,
                user: req.session.user,
                rows: [{
                    ...req.body,
                    id: req.params.id
                }]
            });
        }

        updateOrderAdmin(req, res);
    }
);
app.post('/updateOrderStatus/:id', ensureAuthenticated, ensureAdmin, updateOrderStatus);
app.get('/manageorders/deleteorderadmin/:id', ensureAuthenticated, ensureAdmin, deleteOrder);

app.get('/myorders', ensureAuthenticated, ensureUser, myorders);
app.post('/myorders', ensureAuthenticated, ensureUser, findOrders);
app.get('/myorders/addorder', ensureAuthenticated, ensureUser, formOrder);
app.post('/myorders/addorder', ensureAuthenticated, ensureUser,
    body('good').isLength({ min: 2, max: 50 }).withMessage('Название должно быть длиной от 2 до 50 символов!'),
    body('quantity').isInt({ min: 1, max: 500 }).withMessage('Вы можете заказать от 1 до 500 единиц товара!'),
    body('price').isFloat({ min: 1, max: 1000000 }).withMessage('Стоимость может принимать только численные значения!'),
    body('link').isURL().withMessage('Некорректный формат ссылки!'),
    body('arrival_date').isAfter().withMessage('Желаемая дата доставки не может быть раньше текущего дня!'),
    (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            const errorMsg = errors.array().map(e => e.msg).join(' ');

            return res.render('add-order', {
                title: 'Оформление заказа',
                alert: errorMsg,
                good: req.body.good,
                quantity: req.body.quantity,
                price: req.body.price,
                link: req.body.link,
                arrival_date: req.body.arrival_date,
                isAuthenticated: req.session.isAuthenticated,
                user: req.session.user
            });
        }

        createOrder(req, res);
    }
);


app.get('/myorders/editorder/:id', ensureAuthenticated, ensureUser, editOrder);
app.post('/myorders/editorder/:id', ensureAuthenticated, ensureUser,
    body('good').isLength({ min: 2, max: 50 }).withMessage('Название должно быть длиной от 2 до 50 символов!'),
    body('quantity').isInt({ min: 1, max: 500 }).withMessage('Вы можете заказать от 1 до 500 единиц товара!'),
    body('price').isFloat({ min: 1, max: 1000000 }).withMessage('Стоимость может принимать только численные значения!'),
    body('link').isURL().withMessage('Некорректный формат ссылки!'),
    body('arrival_date').isAfter().withMessage('Желаемая дата доставки не может быть раньше текущего дня!'),
    (req, res) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            const errorMsg = errors.array().map(e => e.msg).join(' ');
        
            return res.render('edit-order', {
                title: 'Изменение заказа',
                alert: errorMsg,
                isAuthenticated: req.session.isAuthenticated,
                user: req.session.user,
                rows: [{
                    ...req.body,
                    id: req.params.id
                }]
            });
        }

        updateOrder(req, res);
    }
);

app.listen(port, () => {
    console.log(`Listening on port ${port}`);
    mlog(`Listening on port ${port}`);
});
