// const { program } = require('commander');
import {program} from 'commander'
import {generateEgFromPrisma} from './generate-eg.js'


program
  .command('generate-elasticgraph-model <egClientName>')
  .action((egClientName) => {
    const prismaGeneratedClientPath = './generated-clients/postgres/index.js'
    const outputFolderPath = './src/datasources/eg_config'
    generateEgFromPrisma(prismaGeneratedClientPath, outputFolderPath, egClientName);
  });

program.parse(process.argv);

