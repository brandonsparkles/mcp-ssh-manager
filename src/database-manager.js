/**
 * Database Manager for MCP SSH Manager
 * Provides database operations for MySQL, PostgreSQL, and MongoDB
 */

// Supported database types
export const DB_TYPES = {
  MYSQL: 'mysql',
  POSTGRESQL: 'postgresql',
  MONGODB: 'mongodb'
};

// Default ports
export const DB_PORTS = {
  mysql: 3306,
  postgresql: 5432,
  mongodb: 27017
};

function shellQuote(value) {
  const quote = String.fromCharCode(39);
  return quote + String(value).replace(/'/g, quote + '\\' + quote + quote) + quote;
}

function shellJoin(values) {
  return values.map(shellQuote).join(' ');
}

function posixDirname(value) {
  const text = String(value);
  const index = text.lastIndexOf('/');
  if (index < 0) return '.';
  if (index === 0) return '/';
  return text.slice(0, index);
}

function posixBasename(value) {
  const text = String(value);
  const index = text.lastIndexOf('/');
  return index < 0 ? text : text.slice(index + 1);
}

function assertSafeMongoCollection(collection) {
  if (!/^[A-Za-z0-9_.-]+$/.test(collection || '')) {
    throw new Error('MongoDB collection name contains unsafe characters');
  }
}

function assertSafeDatabaseName(database) {
  if (!/^[A-Za-z0-9_.-]+$/.test(database || '')) {
    throw new Error('Database name contains unsafe characters');
  }
}

/**
 * Build MySQL dump command
 */
export function buildMySQLDumpCommand(options) {
  const {
    database,
    user,
    password,
    host = 'localhost',
    port = 3306,
    outputFile,
    compress = true,
    tables = null
  } = options;

  let command = '';
  if (password) {
    command = `MYSQL_PWD=${shellQuote(password)} `;
  }

  command += 'mysqldump';

  if (user) command += ` -u ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -P ${shellQuote(port)}`;

  command += ' --single-transaction --routines --triggers';
  command += ` ${shellQuote(database)}`;

  if (tables && Array.isArray(tables)) {
    command += ` ${shellJoin(tables)}`;
  }

  if (compress) {
    command += ` | gzip > ${shellQuote(outputFile)}`;
  } else {
    command += ` > ${shellQuote(outputFile)}`;
  }

  return command;
}

/**
 * Build PostgreSQL dump command
 */
export function buildPostgreSQLDumpCommand(options) {
  const {
    database,
    user,
    password,
    host = 'localhost',
    port = 5432,
    outputFile,
    compress = true,
    tables = null
  } = options;

  let command = '';
  if (password) {
    command = `PGPASSWORD=${shellQuote(password)} `;
  }

  command += 'pg_dump';
  if (user) command += ` -U ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -p ${shellQuote(port)}`;
  command += ' --format=custom --clean --if-exists';

  if (tables && Array.isArray(tables)) {
    for (const table of tables) {
      command += ` -t ${shellQuote(table)}`;
    }
  }

  command += ` ${shellQuote(database)}`;

  if (compress) {
    command += ` | gzip > ${shellQuote(outputFile)}`;
  } else {
    command += ` > ${shellQuote(outputFile)}`;
  }

  return command;
}

/**
 * Build MongoDB dump command
 */
export function buildMongoDBDumpCommand(options) {
  const {
    database,
    user,
    password,
    host = 'localhost',
    port = 27017,
    outputDir,
    compress = true,
    collections = null
  } = options;

  let command = 'mongodump';
  if (host) command += ` --host ${shellQuote(host)}`;
  if (port) command += ` --port ${shellQuote(port)}`;
  if (user) command += ` --username ${shellQuote(user)}`;
  if (password) command += ` --password ${shellQuote(password)}`;
  if (database) command += ` --db ${shellQuote(database)}`;

  if (collections && Array.isArray(collections)) {
    for (const collection of collections) {
      command += ` --collection ${shellQuote(collection)}`;
    }
  }

  command += ` --out ${shellQuote(outputDir)}`;

  if (compress) {
    command += ` && tar -czf ${shellQuote(`${outputDir}.tar.gz`)} -C ${shellQuote(posixDirname(outputDir))} ${shellQuote(posixBasename(outputDir))}`;
    command += ` && rm -rf ${shellQuote(outputDir)}`;
  }

  return command;
}

/**
 * Build MySQL import command
 */
export function buildMySQLImportCommand(options) {
  const {
    database,
    user,
    password,
    host = 'localhost',
    port = 3306,
    inputFile
  } = options;

  let command = '';

  if (inputFile.endsWith('.gz')) {
    command = `gunzip -c ${shellQuote(inputFile)} | `;
  } else {
    command = `cat ${shellQuote(inputFile)} | `;
  }

  if (password) command += `MYSQL_PWD=${shellQuote(password)} `;
  command += 'mysql';
  if (user) command += ` -u ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -P ${shellQuote(port)}`;
  command += ` ${shellQuote(database)}`;

  return command;
}

/**
 * Build PostgreSQL import command
 */
export function buildPostgreSQLImportCommand(options) {
  const {
    database,
    user,
    password,
    host = 'localhost',
    port = 5432,
    inputFile
  } = options;

  let command = '';
  if (password) {
    command = `PGPASSWORD=${shellQuote(password)} `;
  }

  command += 'pg_restore';
  if (user) command += ` -U ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -p ${shellQuote(port)}`;
  command += ' --clean --if-exists';
  command += ` -d ${shellQuote(database)}`;

  if (inputFile.endsWith('.gz')) {
    command = `gunzip -c ${shellQuote(inputFile)} | ${command}`;
  } else {
    command += ` ${shellQuote(inputFile)}`;
  }

  return command;
}

/**
 * Build MongoDB restore command
 */
export function buildMongoDBRestoreCommand(options) {
  const {
    user,
    password,
    host = 'localhost',
    port = 27017,
    inputPath,
    drop = true
  } = options;

  let command = '';

  if (inputPath.endsWith('.tar.gz')) {
    const extractDir = inputPath.replace('.tar.gz', '');
    command = `tar -xzf ${shellQuote(inputPath)} -C ${shellQuote(posixDirname(inputPath))} && `;
    command += 'mongorestore';
    if (drop) command += ' --drop';
    if (host) command += ` --host ${shellQuote(host)}`;
    if (port) command += ` --port ${shellQuote(port)}`;
    if (user) command += ` --username ${shellQuote(user)}`;
    if (password) command += ` --password ${shellQuote(password)}`;
    command += ` ${shellQuote(extractDir)}`;
    command += ` && rm -rf ${shellQuote(extractDir)}`;
  } else {
    command = 'mongorestore';
    if (drop) command += ' --drop';
    if (host) command += ` --host ${shellQuote(host)}`;
    if (port) command += ` --port ${shellQuote(port)}`;
    if (user) command += ` --username ${shellQuote(user)}`;
    if (password) command += ` --password ${shellQuote(password)}`;
    command += ` ${shellQuote(inputPath)}`;
  }

  return command;
}

/**
 * Build MySQL list databases command
 */
export function buildMySQLListDatabasesCommand(options) {
  const { user, password, host = 'localhost', port = 3306 } = options;

  let command = '';
  if (password) command = `MYSQL_PWD=${shellQuote(password)} `;
  command += 'mysql';
  if (user) command += ` -u ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -P ${shellQuote(port)}`;
  command += ' -e "SHOW DATABASES;" | tail -n +2';

  return command;
}

/**
 * Build MySQL list tables command
 */
export function buildMySQLListTablesCommand(options) {
  const { database, user, password, host = 'localhost', port = 3306 } = options;
  assertSafeDatabaseName(database);

  let command = '';
  if (password) command = `MYSQL_PWD=${shellQuote(password)} `;
  command += 'mysql';
  if (user) command += ` -u ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -P ${shellQuote(port)}`;
  command += ` -e ${shellQuote(`USE ${database}; SHOW TABLES;`)} | tail -n +2`;

  return command;
}

/**
 * Build PostgreSQL list databases command
 */
export function buildPostgreSQLListDatabasesCommand(options) {
  const { user, password, host = 'localhost', port = 5432 } = options;

  let command = '';
  if (password) {
    command = `PGPASSWORD=${shellQuote(password)} `;
  }

  command += 'psql';
  if (user) command += ` -U ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -p ${shellQuote(port)}`;
  command += ' -t -c "SELECT datname FROM pg_database WHERE datistemplate = false;" | sed \'/^$/d\' | sed \'s/^[ \\t]*//\'';

  return command;
}

/**
 * Build PostgreSQL list tables command
 */
export function buildPostgreSQLListTablesCommand(options) {
  const { database, user, password, host = 'localhost', port = 5432 } = options;

  let command = '';
  if (password) {
    command = `PGPASSWORD=${shellQuote(password)} `;
  }

  command += 'psql';
  if (user) command += ` -U ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -p ${shellQuote(port)}`;
  command += ` -d ${shellQuote(database)}`;
  command += ' -t -c "SELECT tablename FROM pg_tables WHERE schemaname = \'public\';" | sed \'/^$/d\' | sed \'s/^[ \\t]*//\'';

  return command;
}

/**
 * Build MongoDB list databases command
 */
export function buildMongoDBListDatabasesCommand(options) {
  const { user, password, host = 'localhost', port = 27017 } = options;

  let command = 'mongosh';
  if (host) command += ` --host ${shellQuote(host)}`;
  if (port) command += ` --port ${shellQuote(port)}`;
  if (user) command += ` --username ${shellQuote(user)}`;
  if (password) command += ` --password ${shellQuote(password)}`;
  command += ' --quiet --eval "db.adminCommand(\'listDatabases\').databases.forEach(function(d){print(d.name)})"';

  return command;
}

/**
 * Build MongoDB list collections command
 */
export function buildMongoDBListCollectionsCommand(options) {
  const { database, user, password, host = 'localhost', port = 27017 } = options;

  let command = 'mongosh';
  if (host) command += ` --host ${shellQuote(host)}`;
  if (port) command += ` --port ${shellQuote(port)}`;
  if (user) command += ` --username ${shellQuote(user)}`;
  if (password) command += ` --password ${shellQuote(password)}`;
  command += ` ${shellQuote(database)}`;
  command += ' --quiet --eval "db.getCollectionNames().forEach(function(c){print(c)})"';

  return command;
}

/**
 * Build MySQL query command (SELECT only)
 */
export function buildMySQLQueryCommand(options) {
  const { database, query, user, password, host = 'localhost', port = 3306, format = 'json' } = options;

  // Validate query is SELECT only
  if (!isSafeQuery(query)) {
    throw new Error('Only SELECT queries are allowed');
  }

  let command = '';
  if (password) command = `MYSQL_PWD=${shellQuote(password)} `;
  command += 'mysql';
  if (user) command += ` -u ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -P ${shellQuote(port)}`;
  command += ` ${shellQuote(database)}`;

  if (format === 'json') {
    // Use JSON output if MySQL 5.7.8+
    command += ` -e ${shellQuote(query)} --batch --skip-column-names | awk 'BEGIN{print "["} {if(NR>1)print ","; printf "{\\"row\\":%d,\\"data\\":\\"%s\\"}", NR, $0} END{print "]"}'`;
  } else {
    command += ` -e ${shellQuote(query)}`;
  }

  return command;
}

/**
 * Build PostgreSQL query command (SELECT only)
 */
export function buildPostgreSQLQueryCommand(options) {
  const { database, query, user, password, host = 'localhost', port = 5432 } = options;

  if (!isSafeQuery(query)) {
    throw new Error('Only SELECT queries are allowed');
  }

  let command = '';
  if (password) {
    command = `PGPASSWORD=${shellQuote(password)} `;
  }

  command += 'psql';
  if (user) command += ` -U ${shellQuote(user)}`;
  if (host) command += ` -h ${shellQuote(host)}`;
  if (port) command += ` -p ${shellQuote(port)}`;
  command += ` -d ${shellQuote(database)}`;
  command += ` -c ${shellQuote(query)}`;

  return command;
}

/**
 * Build MongoDB query command
 */
export function buildMongoDBQueryCommand(options) {
  const { database, collection, query, user, password, host = 'localhost', port = 27017 } = options;
  assertSafeMongoCollection(collection);

  // Coerce the query filter to plain JSON data so it cannot inject JS into the
  // --eval program. An empty/blank query means "match everything".
  let filter;
  if (query === undefined || query === null || String(query).trim() === '') {
    filter = '{}';
  } else {
    let parsed;
    try {
      parsed = JSON.parse(query);
    } catch (e) {
      throw new Error('MongoDB query must be a valid JSON filter object');
    }
    filter = JSON.stringify(parsed);
  }

  let command = 'mongosh';
  if (host) command += ` --host ${shellQuote(host)}`;
  if (port) command += ` --port ${shellQuote(port)}`;
  if (user) command += ` --username ${shellQuote(user)}`;
  if (password) command += ` --password ${shellQuote(password)}`;
  command += ` ${shellQuote(database)}`;
  command += ` --quiet --eval ${shellQuote(`db.getCollection(${JSON.stringify(collection)}).find(${filter}).forEach(printjson)`)}`;

  return command;
}

/**
 * Validate query is safe (SELECT only)
 */
export function isSafeQuery(query) {
  const trimmedQuery = query.trim().toLowerCase();

  // Must start with SELECT
  if (!trimmedQuery.startsWith('select')) {
    return false;
  }

  // Block dangerous keywords
  const dangerousKeywords = [
    'insert', 'update', 'delete', 'drop', 'create', 'alter',
    'truncate', 'grant', 'revoke', 'exec', 'execute'
  ];

  for (const keyword of dangerousKeywords) {
    // Match whole words only so columns/tables like `created_at` or
    // `order_updates` are not mistaken for `create` / `update`.
    if (new RegExp(`\\b${keyword}\\b`).test(trimmedQuery)) {
      return false;
    }
  }

  return true;
}

/**
 * Parse database list output
 */
export function parseDatabaseList(output, type) {
  const lines = output.trim().split('\n').filter(l => l.trim());

  // Filter out system databases
  return lines.filter(db => {
    const dbLower = db.toLowerCase();
    if (type === DB_TYPES.MYSQL) {
      return !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(dbLower);
    } else if (type === DB_TYPES.POSTGRESQL) {
      return !['template0', 'template1', 'postgres'].includes(dbLower);
    } else if (type === DB_TYPES.MONGODB) {
      return !['admin', 'config', 'local'].includes(dbLower);
    }
    return true;
  });
}

/**
 * Parse table/collection list output
 */
export function parseTableList(output) {
  return output.trim().split('\n').filter(l => l.trim());
}

/**
 * Estimate dump size command
 */
export function buildEstimateSizeCommand(type, database, options = {}) {
  const { user, password, host = 'localhost', port } = options;

  switch (type) {
  case DB_TYPES.MYSQL: {
    assertSafeDatabaseName(database);
    let command = '';
    if (password) command = `MYSQL_PWD=${shellQuote(password)} `;
    command += 'mysql';
    if (user) command += ` -u ${shellQuote(user)}`;
    if (host) command += ` -h ${shellQuote(host)}`;
    if (port) command += ` -P ${shellQuote(port)}`;
    command += ` -e ${shellQuote(`SELECT SUM(data_length + index_length) FROM information_schema.TABLES WHERE table_schema='${database}';`)} | tail -n 1`;
    return command;
  }

  case DB_TYPES.POSTGRESQL: {
    assertSafeDatabaseName(database);
    let command = '';
    if (password) {
      command = `PGPASSWORD=${shellQuote(password)} `;
    }
    command += 'psql';
    if (user) command += ` -U ${shellQuote(user)}`;
    if (host) command += ` -h ${shellQuote(host)}`;
    if (port) command += ` -p ${shellQuote(port)}`;
    command += ` -d ${shellQuote(database)}`;
    command += ` -t -c ${shellQuote(`SELECT pg_database_size('${database}');`)} | sed 's/^[ \\t]*//'`;
    return command;
  }

  case DB_TYPES.MONGODB: {
    let command = 'mongosh';
    if (host) command += ` --host ${shellQuote(host)}`;
    if (port) command += ` --port ${shellQuote(port)}`;
    if (user) command += ` --username ${shellQuote(user)}`;
    if (password) command += ` --password ${shellQuote(password)}`;
    command += ` ${shellQuote(database)}`;
    command += ' --quiet --eval "db.stats().dataSize"';
    return command;
  }

  default:
    throw new Error(`Unknown database type: ${type}`);
  }
}

/**
 * Parse size output to bytes
 */
export function parseSize(output) {
  const size = parseInt(output.trim());
  return isNaN(size) ? 0 : size;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get database connection info
 */
export function getConnectionInfo(type, options) {
  const { host = 'localhost', port, user, database } = options;
  const defaultPort = DB_PORTS[type];

  return {
    type,
    host,
    port: port || defaultPort,
    user: user || 'default',
    database: database || 'all'
  };
}
