import { Command } from 'commander'

const program = new Command()
program.name('atlas').description('CropsIntel V3 Atlas — production-house conductor').version('0.1.0')

program
  .command('server')
  .description('Start the Atlas HTTP server')
  .action(() => {
    const { startServer } = require('./server')
    startServer()
  })

program.parse(process.argv)
