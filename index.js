import {mlog} from './vendor/logs.js'
console.log(`Current directory: ${process.cwd()}`);
mlog(`Current directory: ${process.cwd()}`);

import express from 'express'
import exphbs from 'express-handlebars'
import mysql from 'mysql2/promise';
import cookieParser from 'cookie-parser'

import { fileURLToPath } from 'url';
import { dirname } from 'path';

import bodyParser from 'body-parser';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env') });

import {view,find,viewarchive,vieworder,myorders,findOrders,manageOrders,updateOrderStatus,formOrder,createOrder,editOrder,updateOrder,editOrderAdmin,updateOrderAdmin,deleteOrder} from './vendor/db.js'
import { createSsoAuth } from './vendor/ssoAuth.js'

const app = express();
app.set('trust proxy', 1);
const port = process.env.PORT || 5000;

// parsing middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cookieParser());

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

const ssoAuth = createSsoAuth({ pool });
app.use(ssoAuth.attachSession);

//connect to db
async function checkDbConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        connection.release();
    } catch (err) {
        console.error('Error connecting to the database: ', err.message);
        mlog('Error connecting to the database: ', err.message);
    }
}
checkDbConnection();

//is auth
app.use((req, res, next) => {
    res.locals.isAuthenticated = req.session.user ? true : false;
    res.locals.user = req.session.user;
    console.log('isAuthenticated:', res.locals.isAuthenticated);
    mlog('isAuthenticated:', res.locals.isAuthenticated);
    next();
});

export function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    const returnTo = encodeURIComponent(req.originalUrl || '/');
    res.redirect(`/api/auth/login?return_to=${returnTo}`);
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

function disabledUserManagement(req, res) {
    res.redirect('/dashboard?error=' + encodeURIComponent('Локальное управление пользователями отключено. Пользователи и роли управляются через SSO.'));
}

// routes

app.get('/', ensureAuthenticated, (req, res) => {
    res.redirect(ssoAuth.landingFor(req.session.user));
});

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', service: 'purchase-service' });
});

app.get('/not-authorized', (_req, res) => {
    res.status(403).send('Нет доступа к сервису buy. Проверьте роль в SSO.');
});

app.get('/api/auth/login', ssoAuth.login);
app.get('/api/cb', ssoAuth.callback);
app.get('/api/auth/logout', ssoAuth.logout);
app.get('/api/me', ssoAuth.me);

app.get('/login', ssoAuth.login);
app.post('/login', (_req, res) => res.status(410).send('Local password login is disabled. Use SSO.'));
app.get('/register', (_req, res) => res.redirect('/api/auth/login'));
app.post('/register', (_req, res) => res.status(410).send('Local registration is disabled. Users are managed in SSO.'));
app.get('/logout', ssoAuth.logout);

app.get('/dashboard', ensureAuthenticated, ensureAdmin, view);
app.post('/dashboard', ensureAuthenticated, ensureAdmin, find);
app.get('/dashboard/adduser', ensureAuthenticated, ensureAdmin, disabledUserManagement);
app.post('/dashboard/adduser', ensureAuthenticated, ensureAdmin, disabledUserManagement);
app.get('/dashboard/edituser/:id', ensureAuthenticated, ensureAdmin, disabledUserManagement);
app.post('/dashboard/edituser/:id', ensureAuthenticated, ensureAdmin, disabledUserManagement);
app.get('/dashboard/vieworder/:source/:id', ensureAuthenticated, ensureAdmin, vieworder);
app.get('/dashboard/vieworder/:id', ensureAuthenticated, ensureAdmin, vieworder);
app.get('/dashboard/:id', ensureAuthenticated, ensureAdmin, disabledUserManagement);

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
