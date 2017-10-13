import knex from '../knexfile'

const environment = process.env.NODE_ENV || 'development'

export default {
  environment,
  knex: knex[environment],
  server: {
    host: process.env.NODE_HOST || process.env.HOST || '0.0.0.0',
    port: process.env.NODE_PORT || process.env.PORT || 3000
  }
}
