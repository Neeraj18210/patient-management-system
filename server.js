require('dotenv').config();

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TABLE_NAME = 'details_table';
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'patient_management_system',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function quoteIdentifier(value) {
  return `\`${value.replace(/`/g, '``')}\``;
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': MIME_TYPES['.json'] });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('Request body is too large.');
  }
  return body ? JSON.parse(body) : {};
}

async function getColumns() {
  const [columns] = await pool.query(`SHOW COLUMNS FROM ${quoteIdentifier(TABLE_NAME)}`);
  return columns.map((column) => ({
    name: column.Field,
    type: column.Type,
    nullable: column.Null === 'YES',
    key: column.Key,
    defaultValue: column.Default,
    extra: column.Extra,
  }));
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    const [rows] = await pool.query('SELECT COUNT(*) AS total FROM ??', [TABLE_NAME]);
    return sendJson(response, 200, { status: 'connected', table: TABLE_NAME, total: rows[0].total });
  }

  if (request.method === 'GET' && url.pathname === '/api/schema') {
    const columns = await getColumns();
    return sendJson(response, 200, {
      table: TABLE_NAME,
      columns,
      primaryKey: columns.find((column) => column.key === 'PRI')?.name || null,
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/records') {
    const columns = await getColumns();
    const primaryKey = columns.find((column) => column.key === 'PRI')?.name;
    const order = primaryKey ? ` ORDER BY ${quoteIdentifier(primaryKey)} DESC` : '';
    const [records] = await pool.query(`SELECT * FROM ${quoteIdentifier(TABLE_NAME)}${order} LIMIT 500`);
    return sendJson(response, 200, records);
  }

  if (request.method === 'POST' && url.pathname === '/api/records') {
    const columns = await getColumns();
    const body = await readBody(request);
    const writable = columns.filter((column) => !column.extra.toLowerCase().includes('auto_increment'));
    const missingField = writable.find((column) => !column.nullable
      && column.defaultValue === null
      && (body[column.name] === undefined || body[column.name] === null || String(body[column.name]).trim() === ''));
    if (missingField) {
      return sendJson(response, 400, { error: `Enter a value for required field: ${missingField.name}.` });
    }
    const fields = writable.filter((column) => Object.hasOwn(body, column.name));
    if (!fields.length) return sendJson(response, 400, { error: 'Enter at least one field before saving.' });
    const names = fields.map((column) => quoteIdentifier(column.name)).join(', ');
    const placeholders = fields.map(() => '?').join(', ');
    const values = fields.map((column) => body[column.name] === '' ? null : body[column.name]);
    await pool.query(`INSERT INTO ${quoteIdentifier(TABLE_NAME)} (${names}) VALUES (${placeholders})`, values);
    return sendJson(response, 201, { saved: true });
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[1] === 'records' && segments[2] && ['PATCH', 'DELETE'].includes(request.method)) {
    const columns = await getColumns();
    const primaryKey = columns.find((column) => column.key === 'PRI');
    if (!primaryKey) return sendJson(response, 409, { error: 'Editing requires a primary key on details_table.' });
    const recordId = decodeURIComponent(segments[2]);
    if (request.method === 'DELETE') {
      const [result] = await pool.execute(`DELETE FROM ${quoteIdentifier(TABLE_NAME)} WHERE ${quoteIdentifier(primaryKey.name)} = ?`, [recordId]);
      if (!result.affectedRows) return sendJson(response, 404, { error: 'Record not found.' });
      return sendJson(response, 200, { deleted: true });
    }

    const body = await readBody(request);
    const fields = columns.filter((column) => column.name !== primaryKey.name
      && !column.extra.toLowerCase().includes('auto_increment')
      && Object.hasOwn(body, column.name));
    if (!fields.length) return sendJson(response, 400, { error: 'There are no editable fields in this request.' });
    const assignments = fields.map((column) => `${quoteIdentifier(column.name)} = ?`).join(', ');
    const values = fields.map((column) => body[column.name] === '' ? null : body[column.name]);
    values.push(recordId);
    const [result] = await pool.execute(`UPDATE ${quoteIdentifier(TABLE_NAME)} SET ${assignments} WHERE ${quoteIdentifier(primaryKey.name)} = ?`, values);
    if (!result.affectedRows) return sendJson(response, 404, { error: 'Record not found.' });
    return sendJson(response, 200, { saved: true });
  }

  return sendJson(response, 404, { error: 'API route not found.' });
}

async function serveStatic(response, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  } catch {
    response.writeHead(400);
    return response.end('Bad request');
  }

  const filePath = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    response.writeHead(403);
    return response.end('Forbidden');
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Page not found');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
    } else {
      await serveStatic(response, url);
    }
  } catch (error) {
    const fieldName = error.sqlMessage?.match(/Column '([^']+)'/)?.[1];
    const inputErrorCodes = new Set([
      'ER_BAD_NULL_ERROR',
      'ER_DATA_TOO_LONG',
      'ER_NO_DEFAULT_FOR_FIELD',
      'ER_TRUNCATED_WRONG_VALUE',
      'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
      'ER_WARN_DATA_OUT_OF_RANGE',
    ]);
    const status = error instanceof SyntaxError ? 400
      : error.code === 'ER_DUP_ENTRY' ? 409
        : inputErrorCodes.has(error.code) ? 400
          : 500;
    const message = error instanceof SyntaxError
      ? 'Invalid JSON request body.'
      : error.code === 'ER_DUP_ENTRY'
        ? 'A record with that unique value already exists. Check the patient ID.'
        : error.code === 'ER_BAD_NULL_ERROR' || error.code === 'ER_NO_DEFAULT_FOR_FIELD'
          ? `Enter a value for required field${fieldName ? `: ${fieldName}` : ''}.`
          : error.code === 'ER_DATA_TOO_LONG'
            ? `The value for ${fieldName || 'a field'} is too long.`
            : error.code === 'ER_NO_SUCH_TABLE'
              ? `MySQL table ${TABLE_NAME} was not found in ${process.env.DB_NAME || 'patient_management_system'}.`
              : error.code === 'ER_ACCESS_DENIED_ERROR'
                ? 'MySQL rejected the username or password. Check the local .env settings.'
                : error.code === 'ECONNREFUSED'
                  ? 'Cannot reach MySQL. Make sure the MySQL server is running.'
                  : inputErrorCodes.has(error.code)
                    ? `MySQL rejected a field value (${error.code}). Check the entered details.`
                    : 'Database request failed. Check the MySQL connection and table schema.';
    sendJson(response, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Neeraj Patient Management System is running at http://localhost:${PORT}`);
});
