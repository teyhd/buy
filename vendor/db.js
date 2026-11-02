import express from 'express';
// import session from 'express-session';
import mysql from 'mysql2';

let sets = {
    host: process.env.LEGACY_HOST,
    port: 3407,
    user: process.env.LEGACY_USER,
    password: process.env.LEGACY_PASSWORD,
    database: process.env.LEGACY_DATABASE,
    charset: 'utf8mb4_0900_ai_ci',
  };

  const app = express();
  const pool = mysql.createPool(sets).promise();

  export async function checkConnection() {
    try {
      const connection = await pool.getConnection();
      console.log('Успешное подключение к БД');
      connection.release();
    } catch (err) {
      console.error('Ошибка подключения к БД:', err);
    }
  }

  export async function get_username(username){
    const qer = 'SELECT * FROM users WHERE username = ?';
    const [rows, fields] = await pool.query(qer, [username]);
    return rows;
}

export async function insert_user(username, email, password){
    const qer = 'INSERT INTO users (username, password, admin) VALUES (?, ?, ?)';
    await pool.query(qer, [username, email, password, 0]);
}

// export async function get_user_orders(pool, userId){
//     const qer = 'SELECT *, Status = "Забрать" AS CanComplete FROM orders WHERE UserID = ? AND Status != "Завершено"';
//     const [rows, fields] = await pool.query(qer, [userId]);
//     return rows;
// }

export async function get_zakaz(userId) {
    const query = 'SELECT * FROM orders WHERE UserID = ? ORDER BY OrderID DESC';
    const [rows] = await pool.query(query, [userId]);
    return rows;
  }

  // export async function submit_order(order, userId) {
  //   await pool.execute(
  //     'INSERT INTO orders (ProductName, Quantity, URL, price, StartDate, Author, Status, userId) VALUES (?, ?, ?, ?, ?, ?, "На рассмотрении", ?)',
  //     [
  //       order.ProductName,
  //       order.Quantity,
  //       order.URL,
  //       order.price,
  //       order.StartDate,
  //       order.Author,
  //       userId,
  //     ].map((param) => {
  //       if (typeof param === 'undefined') {
  //         return null;
  //       }
  //       return param;
  //     }),
  //   );
  // }
  export async function submit_order(pool, order, userId){
    const qer = 'INSERT INTO orders (ProductName, Quantity, URL, price, StartDate, Author, Status, userId) VALUES (?, ?, ?, ?, ?, ?, "На рассмотрении", ?)';
    await pool.query(qer, [
      order.ProductName,
      order.Quantity,
      order.URL,
      order.price,
      order.StartDate,
      order.Author,
      userId,]);
}


  export async function get_all_orders() {
    const [rows] = await pool.execute('SELECT * FROM orders');

    return rows.map((row) => {
      return {
        OrderID: row.OrderID,
        ProductName: row.ProductName,
        Quantity: row.Quantity,
        URL: row.URL,
        StartDate: row.StartDate,
        EndDate: row.EndDate,
        Author: row.Author,
        Status: row.Status,
      };
    });
  }


  export async function update_status(status, orderId) {
    await pool.execute('UPDATE orders SET Status = ? WHERE OrderID = ?', [status, orderId]);
  }




  export async function get_filtered_orders(status) {
    const query = status === ' '
      ? 'SELECT * FROM orders ORDER BY OrderID DESC'
      : 'SELECT * FROM orders WHERE Status = ? ORDER BY OrderID DESC';
    const params = status === ' ' ? [] : [status];
    const [rows] = await pool.query(query, params);

    return rows.map((row) => {
      return {
        OrderID: row.OrderID,
        ProductName: row.ProductName,
        Quantity: row.Quantity,
        URL: row.URL,
        StartDate: row.StartDate,
        EndDate: row.EndDate,
        Author: row.Author,
        Status: row.Status,
      };
    });
}
  export default pool;
