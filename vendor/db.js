import dotenv from 'dotenv';
dotenv.config();
import { pool } from '../index.js';
import { mlog } from './logs.js';


//register
export const register = async (req, res) => {
    const { surname, name, patname, email, password } = req.body;

    try {
        // check if the users email is unique
        const checkQuery = 'SELECT * FROM users WHERE email = ?';
        const [users] = await pool.execute(checkQuery, [email]);
        if (users.length > 0) {
            return res.render('register', {
                title: 'Регистрация',
                alert: 'Пользователь с таким логином уже существует!',
                surname, name, patname, email
            });
        }

        const query = 'INSERT INTO users SET surname = ?, name = ?, patname = ?, email = ?, password = ?';
        console.log('Выполняется SQL-запрос: ', query);
        mlog('Выполняется SQL-запрос: ', query);
        const result = await pool.execute(query, [surname, name, patname, email, password]);
        if (result) {
            const [rows, fields] = result;
            res.render('login', { alert: 'Аккаунт успешно создан! Теперь вы можете войти.' });
            console.log('The data from users table: \n', rows);
            mlog('Аккаунт успешно создан!');
        } else {
            console.log('Ошибка!');
            mlog('Ошибка!');
        }
    } catch (err) {
        console.log(err);
        mlog(err);
        res.status(500).render('register', {
            title: 'Регистрация',
            alert: 'Ошибка сервера.'
        });
    }
};


//login
export const login = async (req, res) => {
    const { email, password } = req.body;

    // check for null or undefined
    if (!email || !password) {
        console.log('Ошибка: логин или пароль не определены');
        mlog('Ошибка: логин или пароль не определены');
        return;
    }

    try {
        const query = 'SELECT * FROM users WHERE email = ? AND password = ?';
        console.log('Выполняется SQL-запрос: ', query);
        mlog('Выполняется SQL-запрос: ', query);
        console.log(`Login attempt for: ${email}`)
        mlog(`Login attempt for: ${email}`)

        const connection = await pool.getConnection();
        console.log('Подключено как ID ' + connection.threadId);
        mlog('Подключено как ID ' + connection.threadId);

        const [rows, fields] = await connection.execute(query, [email, password]);
        if (rows.length > 0) {
            req.session.isAuthenticated = true;
            req.session.user = rows[0];
            console.log(`Authenticated user id: ${req.session.user.id}`);
            mlog(`Authenticated user id: ${req.session.user.id}`);

            if (Number(req.session.user.is_admin) == 0) {
                res.redirect('/myorders');
            } else {
                res.redirect('/manageorders');
            }
            
        } else {
            res.render('login', { alert: 'Неверный логин или пароль!' });
        }
        
        connection.release();
    } catch (err) {
        console.error(err);
        mlog(err);
    }
};


// ADMINS PART
//show users
export const view = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        let page = Number(req.query.page) || 1;
        let limit = 8;
        let offset = (page - 1) * limit;
        const query = `SELECT users.*, COUNT(orders.id) as order_count FROM users LEFT JOIN orders ON users.id = orders.author_id WHERE users.is_admin = 0 GROUP BY users.id LIMIT ${limit} OFFSET ${offset}`;
        const [rows, fields] = await connection.query(query);
        
        const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM users');
        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection.release();
        let alert = req.query.removed;
        res.render('dashboard', {
            title: 'База данных', 
            rows, 
            alert, 
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user });
        console.log('The data from users table: \n', rows);
        mlog('База данных пользователей отобразилась!');
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};



export const find = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        let searchTerm = req.body.search;
        
        let page = Number(req.query.page) || 1;
        let limit = 8;
        let offset = (page - 1) * limit;

        const query = `SELECT users.*, COUNT(orders.id) as order_count FROM users LEFT JOIN orders ON users.id = orders.author_id WHERE (users.surname LIKE ?) GROUP BY users.id LIMIT ${limit} OFFSET ${offset}`;
        const [rows, fields] = await connection.query(query, ['%' + searchTerm + '%', '%' + searchTerm + '%']);

        const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM users WHERE surname LIKE ?', ['%' + searchTerm + '%']);
        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection.release();

        res.render('dashboard', {
            title: 'База данных', 
            rows, 
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user });
        console.log('The data from users table: \n', rows);
        mlog('Записи были найдены!');
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};


export const form = (req, res) => {
    res.render('add-user', {title: 'Создание пользователя', isAuthenticated: req.session.isAuthenticated, user: req.session.user});
};


//add new user
export const create = async (req, res) => {
    const { surname, name, patname, email, password} = req.body;

    try {
        // check if the users email is unique
        const checkQuery = 'SELECT * FROM users WHERE email = ?';
        const [users] = await pool.execute(checkQuery, [email]);
        if (users.length > 0) {
            return res.render('add-user', {
                title: 'Создание пользователя',
                alert: 'Пользователь с таким логином уже существует!',
                surname, name, patname, email
            });
        }

        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'INSERT  INTO users SET surname = ?, name = ?, patname = ?, email = ?, password = ?';
        const [rows, fields] = await connection.query(query, [surname, name, patname, email, password]);
        connection.release();
        res.redirect('/dashboard');
        console.log('The data from users table: \n', rows);
        mlog('Новый пользователь был добавлен!');
    } catch (err) {
        console.log(err);
        mlog(err);
        res.status(500).render('add-user', {
            title: 'Создание пользователя',
            alert: 'Ошибка сервера.'
        });
    }
};



 //edit user
 export const edit = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'SELECT * FROM users WHERE id = ?';
        const [rows, fields] = await connection.query(query, [req.params.id]);
        connection.release();
        res.render('edit-user', {title: 'Редактирование пользователя', rows, isAuthenticated: req.session.isAuthenticated, user: req.session.user });
        console.log('The data from users table: \n', rows);
        mlog('Пользователь был отредактирован!');
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};

//update user
export const update = async (req, res) => {
    const { surname, name, patname, email, password} = req.body;
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'UPDATE users SET surname = ?, name = ?, patname =?, email = ?, password = ? WHERE id = ?';
        const [rows, fields] = await connection.query(query, [surname, name, patname, email, password, req.params.id]);

        let page = Number(req.query.page) || 1;
        let limit = 8;
        let offset = (page - 1) * limit;
        const query2 = `SELECT users.*, COUNT(orders.id) as order_count FROM users LEFT JOIN orders ON users.id = orders.author_id WHERE users.is_admin = 0 GROUP BY users.id LIMIT ${limit} OFFSET ${offset}`;
        const [userRows, userFields] = await connection.query(query2);
        
        const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM users');
        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection.release();

        res.render('dashboard', {
            title: 'Панель управления',
            alert: 'Данные пользователя успешно обновлены!',
            rows: userRows,
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        res.status(500).render('edit-user', {
            title: 'Редактирование пользователя',
            alert: 'Ошибка сервера.',
            rows: [{
                surname, name, patname, email, password
            }]
        });
        
    }
};





  
//delete user
export const deleteUser = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'DELETE FROM users WHERE id = ?';
        const [rows, fields] = await connection.query(query, [req.params.id]);
        connection.release();
        res.redirect('/dashboard?removed=Пользователь успешно удален!');
        console.log('The data from users table: \n', rows);
        mlog('Пользователь успешно удален!');
    } catch (err) {
        console.log(err);
        mlog(err);
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            res.redirect('/dashboard?error=Удаление невозможно – у пользователя есть активные заказы!');
        } else {
            res.redirect('/dashboard?error=Произошла неизвестная ошибка...');
        }
    }
};

 //view specific orders
export const vieworder = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);

        let page = Number(req.query.page) || 1;
        let limit = 5;
        let offset = (page - 1) * limit;

        const query = 'SELECT * FROM users WHERE id = ?';
        const [userRows, userFields] = await connection.query(query, [req.params.id]);

        const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM orders WHERE author_id = ? AND status != "Получен"', [req.params.id]);
        
        let totalPages = Math.ceil(totalRows[0].total / limit);

        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        console.log('The data from users table: \n', userRows);
        mlog('Заказы были отображены!');
        const query2 = `SELECT * FROM orders WHERE author_id = ? AND status != 'Получен' LIMIT ${limit} OFFSET ${offset}`;
        const [orderRows, orderFields] = await connection.query(query2, [req.params.id]);
        connection.release();
        res.render('view-order', {
            title: 'Заказы пользователя', viewedUser: userRows[0], 
            orders: orderRows, 
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            isAuthenticated: req.session.isAuthenticated, 
            user: req.session.user });

        console.log('The data from orders table: \n', orderRows);
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};

//edit order admin
export const editOrderAdmin = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'SELECT * FROM orders WHERE id = ?';
        const [rows, fields] = await connection.query(query, [req.params.id]);
        connection.release();
        res.render('edit-order-admin', {title: 'Изменение заказа', rows, isAuthenticated: req.session.isAuthenticated, user: req.session.user });
        console.log('The data from orders table: \n', rows);
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};

export const updateOrderAdmin = async (req, res) => {
    const { quantity, price, link } = req.body;
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'UPDATE orders SET quantity = ?, price = ?, link =? WHERE id = ?';
        await connection.query(query, [quantity, price, link, req.params.id]);

        const [priceCountRows] = await connection.query('SELECT SUM(price) as price_count FROM orders');
        let price_count = priceCountRows[0].price_count;

        let page = Number(req.query.page) || 1;
        let limit = 5;
        let offset = (page - 1) * limit;

        const query2 = `SELECT orders.*, users.email FROM orders JOIN users ON orders.author_id = users.id LIMIT ${limit} OFFSET ${offset}`;
        const [orderRows, orderFields] = await connection.query(query2);

        const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM orders');
        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection.release();

        res.render('manage-orders', {
            title: 'Активные заказы',
            orders: orderRows,
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            price_count: price_count,
            alert: 'Данные заказа успешно обновлены!',
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user
        });
        console.log('The data from orders table: \n', orderRows);
        mlog('Заказ был отредактирован администратором!');
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};

// update order status
export const updateOrderStatus = async (req, res) => {
    const { status } = req.body;
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'UPDATE orders SET status = ? WHERE id = ?';
        await connection.query(query, [status, req.params.id]);

        const [priceCountRows] = await connection.query('SELECT SUM(price) as price_count FROM orders');
        let price_count = priceCountRows[0].price_count;

        let page = Number(req.query.page) || 1;
        let limit = 5;
        let offset = (page - 1) * limit;

        const query2 = `SELECT orders.*, users.email FROM orders JOIN users ON orders.author_id = users.id LIMIT ${limit} OFFSET ${offset}`;
        const [orderRows, orderFields] = await connection.query(query2);

        const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM orders');
        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection.release();

        res.render('manage-orders', {
            title: 'Активные заказы',
            orders: orderRows,
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            price_count: price_count,
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user
        });
    } catch (err) {
        console.log(err);
        mlog(err);
        const errorMessage = encodeURIComponent('Произошла ошибка при обновлении статуса заказа');
        res.status(500).send({ message: errorMessage });
    }
};


// delete order
export const deleteOrder = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'SELECT author_id FROM orders WHERE id = ?';
        const [rows, fields] = await connection.query(query, [req.params.id]);
        if(rows.length === 0) {
            let errorMessage = encodeURIComponent('Произошла ошибка при удалении заказа.');
            res.redirect('/manageorders?error=' + errorMessage);
            return;
        }
        let author_id = rows[0].author_id;
        const query2 = 'DELETE FROM orders WHERE id = ? AND status = "Получен"';
        const [rows2, fields2] = await connection.query(query2, [req.params.id]);
        connection.release();
        let removedMessage;
        if(rows2.affectedRows == 0) {
            removedMessage = encodeURIComponent('Заказ не может быть удален, так как его статус не "Получен".');
        } else {
            removedMessage = encodeURIComponent('Заказ успешно удален.');
        }
        res.redirect('/manageorders?removed=' + removedMessage);
    } catch (err) {
        console.log(err);
        mlog(err);
        let errorMessage = encodeURIComponent('Произошла ошибка при удалении заказа.');
        res.redirect('/manageorders?error=' + errorMessage);
    }
};

//show archive orders
export const viewarchive = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);

        let page = Number(req.query.page) || 1;
        let limit = 10;
        let offset = (page - 1) * limit;

        const query = `SELECT orders.*, users.email FROM orders JOIN users ON orders.author_id = users.id WHERE orders.status = 'Получен' LIMIT ${limit} OFFSET ${offset}`;
        const [orderRows, orderFields] = await connection.query(query);
        const [priceCountRows] = await connection.query('SELECT SUM(price) as price_count FROM orders WHERE status = "Получен"');
        let price_count = priceCountRows[0].price_count;

        const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM orders WHERE status = "Получен"');
        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection.release();
        res.render('orders-archive', {
            title: 'Архив заказов',
            orders: orderRows,
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
            price_count: price_count
        });
        console.log('The data from orders table: \n', orderRows);
        mlog('Архивные заказы были отображены!');
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};

export const manageOrders = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);

        let page = Number(req.query.page) || 1;
        let limit = 10;
        let offset = (page - 1) * limit;

        let searchTerm = req.query.search;
        let query, totalQuery, priceCountQuery;

        if (searchTerm) {
            query = `SELECT orders.*, users.email FROM orders JOIN users ON orders.author_id = users.id WHERE orders.status = ? LIMIT ${limit} OFFSET ${offset}`;
            totalQuery = 'SELECT COUNT(*) as total FROM orders WHERE status = ?';
            priceCountQuery = 'SELECT SUM(price) as price_count FROM orders WHERE status = ?';
        } else {
            query = `SELECT orders.*, users.email FROM orders JOIN users ON orders.author_id = users.id WHERE orders.status != 'Получен' LIMIT ${limit} OFFSET ${offset}`;
            totalQuery = 'SELECT COUNT(*) as total FROM orders WHERE status != "Получен"';
            priceCountQuery = 'SELECT SUM(price) as price_count FROM orders WHERE status != "Получен"';
        }

        const [orderRows, orderFields] = await connection.query(query, [searchTerm]);
        const [totalRows] = await connection.query(totalQuery, [searchTerm]);
        const [priceCountRows] = await connection.query(priceCountQuery, [searchTerm]);
        let price_count = priceCountRows[0].price_count;

        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection.release();

        res.render('manage-orders', {
            title: 'Все заказы', 
            orders: orderRows, 
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user,
            price_count: price_count,
            searchTerm: searchTerm
        });
        
        console.log('The data from orders table: \n', orderRows);
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};





// USERS PART

    //view orders
    export const myorders = async (req, res) => {
        try {
            const connection = await pool.getConnection();
            console.log('Connected as ID' + connection.threadId);
            mlog('Connected as ID' + connection.threadId);
            let page = Number(req.query.page) || 1;
            let limit = 5;
            let offset = (page - 1) * limit;
            const query = `SELECT * FROM orders WHERE author_id = ? LIMIT ${limit} OFFSET ${offset}`;
            const [rows, fields] = await connection.query(query, [req.session.user.id]);

            const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM orders WHERE author_id = ?', [req.session.user.id]);
            let totalPages = Math.ceil(totalRows[0].total / limit);
            let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
            });

            connection.release();
            res.render('myorders', {
                title: 'Мои заказы', 
                rows,
                page: page,
                totalPages: totalPages,
                prevPage: page > 1 ? page - 1 : null,
                nextPage: page < totalPages ? page + 1 : null,
                pages: pages,
                isAuthenticated: req.session.isAuthenticated
             });
            console.log('The data from orders table: \n', rows);
        } catch (err) {
            console.log(err);
            mlog(err);
        }
    };


export const findOrders = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        let searchTerm = req.body.search;

        let page = Number(req.query.page) || 1;
        let limit = 5;
        let offset = (page - 1) * limit;

        const query = `SELECT * FROM orders WHERE author_id = ? AND good LIKE ? LIMIT ${limit} OFFSET ${offset}`;
        const [rows, fields] = await connection.query(query, [req.session.user.id, '%' + searchTerm + '%']);

        const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM orders WHERE author_id = ? AND good LIKE ?', [req.session.user.id, '%' + searchTerm + '%']);
        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection.release();

        res.render('myorders', {
            title: 'Мои заказы', 
            rows, 
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            isAuthenticated: req.session.isAuthenticated,
            user: req.session.user });
        console.log('The data from orders table: \n', rows);
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};


export const formOrder = (req, res) => {
    res.render('add-order', {title: 'Новый заказ',});
};

//add new order
export const createOrder = async (req, res) => {
    const { good, quantity, price, link, arrival_date } = req.body;
    const author_id = req.session.user.id;
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'INSERT INTO orders SET good = ?, quantity = ?, price = ?, link = ?, creation_date = NOW(), arrival_date = ?, author_id = ?, status = "На рассмотрении"';
        await connection.query(query, [good, quantity, price, link, arrival_date, author_id]);
        connection.release();

        const connection2 = await pool.getConnection();
        console.log('Connected as ID' + connection2.threadId);
        mlog('Connected as ID' + connection2.threadId);
        let page = Number(req.query.page) || 1;
        let limit = 5;
        let offset = (page - 1) * limit;
        const query2 = `SELECT * FROM orders WHERE author_id = ? LIMIT ${limit} OFFSET ${offset}`;
        const [rows2, fields2] = await connection2.query(query2, [req.session.user.id]);

        const [totalRows] = await connection2.query('SELECT COUNT(*) as total FROM orders WHERE author_id = ?', [req.session.user.id]);
        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection2.release();

        res.render('myorders', {
            title: 'Мои заказы', 
            rows: rows2,
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            alert: 'Новый заказ успешно добавлен!',
            isAuthenticated: req.session.isAuthenticated
        });
        console.log('The data from orders table: \n', rows2);
        mlog('Был добавлен новый заказ!');
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};

//edit order
export const editOrder = async (req, res) => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'SELECT * FROM orders WHERE id = ?';
        const [rows, fields] = await connection.query(query, [req.params.id]);
        connection.release();
        res.render('edit-order', {title: 'Изменение заказа', rows });
        console.log('The data from orders table: \n', rows);
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};

//update order
export const updateOrder = async (req, res) => {
    const { good, quantity, price, link, arrival_date } = req.body;
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'UPDATE orders SET good = ?, quantity = ?, price = ?, link =?, arrival_date = ? WHERE id = ?';
        await connection.query(query, [good, quantity, price, link, arrival_date, req.params.id]);
        connection.release();

        const connection2 = await pool.getConnection();
        console.log('Connected as ID' + connection2.threadId);
        mlog('Connected as ID' + connection2.threadId);
        let page = Number(req.query.page) || 1;
        let limit = 5;
        let offset = (page - 1) * limit;
        const query2 = `SELECT * FROM orders WHERE author_id = ? LIMIT ${limit} OFFSET ${offset}`;
        const [rows2, fields2] = await connection2.query(query2, [req.session.user.id]);

        const [totalRows] = await connection2.query('SELECT COUNT(*) as total FROM orders WHERE author_id = ?', [req.session.user.id]);
        let totalPages = Math.ceil(totalRows[0].total / limit);
        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        connection2.release();

        res.render('myorders', {
            title: 'Мои заказы', 
            rows: rows2,
            page: page,
            totalPages: totalPages,
            prevPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null,
            pages: pages,
            alert: 'Данные заказа успешно обновлены!',
            isAuthenticated: req.session.isAuthenticated
        });
        console.log('The data from orders table: \n', rows2);
        mlog('Заказ был отредактирован пользователем!');
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};
