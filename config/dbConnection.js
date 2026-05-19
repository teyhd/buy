const mysql2 = require('mysql2');

//connection pool
const pool = mysql2.createPool({
    connectionLimit : 100,
    host            : process.env.host,
    port            : Number(process.env.DB_PORT) || 3407,
    user            : process.env.user,
    password        : process.env.password,
    database        : process.env.database
});

module.exports = pool;
