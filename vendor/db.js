import dotenv from 'dotenv';
dotenv.config();
import { pool } from '../index.js';
import { mlog } from './logs.js';

const RECEIVED_STATUS = 'Получен';
const OWNER_LABEL_SQL = `COALESCE(
    NULLIF(sso_users.name, ''),
    NULLIF(sso_users.nickname, ''),
    NULLIF(sso_users.msgnickname, ''),
    legacy_users.email,
    CONCAT('SSO #', orders.sso_author_id),
    CONCAT('Legacy #', orders.author_id)
)`;
const ORDER_OWNER_SELECT = `orders.*,
    ${OWNER_LABEL_SQL} AS owner_label,
    ${OWNER_LABEL_SQL} AS email,
    CASE WHEN orders.sso_author_id IS NULL THEN 'legacy' ELSE 'sso' END AS owner_type,
    COALESCE(orders.sso_author_id, orders.author_id) AS owner_ref`;
const ORDER_OWNER_JOINS = `LEFT JOIN sso.users AS sso_users ON sso_users.id = orders.sso_author_id
    LEFT JOIN users AS legacy_users ON legacy_users.id = orders.author_id`;

function getSsoUserId(req) {
    const id = Number(req.session?.user?.sso_id || req.session?.user?.id);
    if (!Number.isFinite(id) || id <= 0) {
        throw new Error('Missing SSO user id in session');
    }
    return id;
}

async function loadMyOrdersPage(connection, req, searchTerm = null) {
    const ssoUserId = getSsoUserId(req);
    const page = Number(req.query.page) || 1;
    const limit = 5;
    const offset = (page - 1) * limit;
    const like = `%${searchTerm || ''}%`;

    const where = searchTerm ? 'sso_author_id = ? AND good LIKE ?' : 'sso_author_id = ?';
    const params = searchTerm ? [ssoUserId, like] : [ssoUserId];
    const [rows] = await connection.query(`SELECT * FROM orders WHERE ${where} LIMIT ${limit} OFFSET ${offset}`, params);
    const [totalRows] = await connection.query(`SELECT COUNT(*) as total FROM orders WHERE ${where}`, params);
    const totalPages = Math.ceil(totalRows[0].total / limit);
    const pages = Array.from({length: totalPages}, (_, i) => {
        return {
            number: i + 1,
            isCurrent: i + 1 === page
        };
    });

    return {
        rows,
        page,
        totalPages,
        prevPage: page > 1 ? page - 1 : null,
        nextPage: page < totalPages ? page + 1 : null,
        pages,
    };
}

function renderMyOrders(res, req, pageData, alert = null) {
    res.render('myorders', {
        title: 'Мои заказы',
        ...pageData,
        alert,
        isAuthenticated: req.session.isAuthenticated,
        user: req.session.user
    });
}


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
        const source = req.params.source === 'sso' ? 'sso' : 'legacy';
        const ownerId = Number(req.params.id);
        const ownerColumn = source === 'sso' ? 'sso_author_id' : 'author_id';

        let userRows;
        if (source === 'sso') {
            const [rows] = await connection.query(
                `SELECT id, name AS surname, '' AS name, '' AS patname,
                    COALESCE(NULLIF(name, ''), NULLIF(nickname, ''), NULLIF(msgnickname, ''), CONCAT('SSO #', id)) AS email
                 FROM sso.users
                 WHERE id = ?
                 LIMIT 1`,
                [ownerId]
            );
            userRows = rows;
        } else {
            const [rows] = await connection.query('SELECT * FROM users WHERE id = ?', [ownerId]);
            userRows = rows;
        }

        const [totalRows] = await connection.query(`SELECT COUNT(*) as total FROM orders WHERE ${ownerColumn} = ? AND status != ?`, [ownerId, RECEIVED_STATUS]);
        
        let totalPages = Math.ceil(totalRows[0].total / limit);

        let pages = Array.from({length: totalPages}, (_, i) => {
            return {
                number: i + 1,
                isCurrent: i + 1 === page
            };
        });

        console.log('The data from users table: \n', userRows);
        mlog('Заказы были отображены!');
        const query2 = `SELECT * FROM orders WHERE ${ownerColumn} = ? AND status != ? LIMIT ${limit} OFFSET ${offset}`;
        const [orderRows, orderFields] = await connection.query(query2, [ownerId, RECEIVED_STATUS]);
        connection.release();
        res.render('view-order', {
            title: 'Заказы пользователя', viewedUser: userRows[0], 
            orders: orderRows, 
            ownerSource: source,
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
        connection.release();
        mlog('Заказ был отредактирован администратором!');
        res.redirect('/manageorders?updated=' + encodeURIComponent('Данные заказа успешно обновлены!'));
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
        connection.release();
        res.redirect('/manageorders');
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

        const query = `SELECT ${ORDER_OWNER_SELECT}
            FROM orders
            ${ORDER_OWNER_JOINS}
            WHERE orders.status = ?
            LIMIT ${limit} OFFSET ${offset}`;
        const [orderRows, orderFields] = await connection.query(query, [RECEIVED_STATUS]);
        const [priceCountRows] = await connection.query('SELECT SUM(price) as price_count FROM orders WHERE status = ?', [RECEIVED_STATUS]);
        let price_count = priceCountRows[0].price_count;

        const [totalRows] = await connection.query('SELECT COUNT(*) as total FROM orders WHERE status = ?', [RECEIVED_STATUS]);
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
        let params = [];

        if (searchTerm) {
            query = `SELECT ${ORDER_OWNER_SELECT}
                FROM orders
                ${ORDER_OWNER_JOINS}
                WHERE orders.status = ?
                LIMIT ${limit} OFFSET ${offset}`;
            totalQuery = 'SELECT COUNT(*) as total FROM orders WHERE status = ?';
            priceCountQuery = 'SELECT SUM(price) as price_count FROM orders WHERE status = ?';
            params = [searchTerm];
        } else {
            query = `SELECT ${ORDER_OWNER_SELECT}
                FROM orders
                ${ORDER_OWNER_JOINS}
                WHERE orders.status != ?
                LIMIT ${limit} OFFSET ${offset}`;
            totalQuery = 'SELECT COUNT(*) as total FROM orders WHERE status != ?';
            priceCountQuery = 'SELECT SUM(price) as price_count FROM orders WHERE status != ?';
            params = [RECEIVED_STATUS];
        }

        const [orderRows, orderFields] = await connection.query(query, params);
        const [totalRows] = await connection.query(totalQuery, params);
        const [priceCountRows] = await connection.query(priceCountQuery, params);
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
            searchTerm: searchTerm,
            alert: req.query.updated
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
            const pageData = await loadMyOrdersPage(connection, req);
            connection.release();
            renderMyOrders(res, req, pageData);
            console.log('The data from orders table: \n', pageData.rows);
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

        const pageData = await loadMyOrdersPage(connection, req, searchTerm);
        connection.release();

        renderMyOrders(res, req, pageData);
        console.log('The data from orders table: \n', pageData.rows);
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};


export const formOrder = (req, res) => {
    res.render('add-order', {title: 'Новый заказ', isAuthenticated: req.session.isAuthenticated, user: req.session.user});
};

//add new order
export const createOrder = async (req, res) => {
    const { good, quantity, price, link, arrival_date } = req.body;
    const ssoAuthorId = getSsoUserId(req);
    try {
        const connection = await pool.getConnection();
        console.log('Connected as ID' + connection.threadId);
        mlog('Connected as ID' + connection.threadId);
        const query = 'INSERT INTO orders SET good = ?, quantity = ?, price = ?, link = ?, creation_date = NOW(), arrival_date = ?, author_id = NULL, sso_author_id = ?, status = "На рассмотрении"';
        await connection.query(query, [good, quantity, price, link, arrival_date, ssoAuthorId]);
        const pageData = await loadMyOrdersPage(connection, req);
        connection.release();

        renderMyOrders(res, req, pageData, 'Новый заказ успешно добавлен!');
        console.log('The data from orders table: \n', pageData.rows);
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
        const query = 'SELECT * FROM orders WHERE id = ? AND sso_author_id = ?';
        const [rows, fields] = await connection.query(query, [req.params.id, getSsoUserId(req)]);
        connection.release();
        if (rows.length === 0) {
            return res.redirect('/myorders');
        }
        res.render('edit-order', {title: 'Изменение заказа', rows, isAuthenticated: req.session.isAuthenticated, user: req.session.user });
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
        const query = 'UPDATE orders SET good = ?, quantity = ?, price = ?, link =?, arrival_date = ? WHERE id = ? AND sso_author_id = ?';
        await connection.query(query, [good, quantity, price, link, arrival_date, req.params.id, getSsoUserId(req)]);
        const pageData = await loadMyOrdersPage(connection, req);
        connection.release();

        renderMyOrders(res, req, pageData, 'Данные заказа успешно обновлены!');
        console.log('The data from orders table: \n', pageData.rows);
        mlog('Заказ был отредактирован пользователем!');
    } catch (err) {
        console.log(err);
        mlog(err);
    }
};
