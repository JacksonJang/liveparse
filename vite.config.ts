import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(projectRoot, 'index.html'),
        koJsonParser: resolve(projectRoot, 'ko/json-parser/index.html'),
        jsonRepair: resolve(projectRoot, 'json-repair/index.html'),
        jsonlParser: resolve(projectRoot, 'jsonl-parser/index.html'),
        jsonToCsv: resolve(projectRoot, 'json-to-csv/index.html'),
        csvToJson: resolve(projectRoot, 'csv-to-json/index.html'),
        jsonCompare: resolve(projectRoot, 'json-compare/index.html'),
        unixTimestampConverter: resolve(projectRoot, 'unix-timestamp-converter/index.html'),
        discordTimestampGenerator: resolve(projectRoot, 'discord-timestamp-generator/index.html'),
        base64Decoder: resolve(projectRoot, 'base64-decoder/index.html'),
        base64Encoder: resolve(projectRoot, 'base64-encoder/index.html'),
        binaryConverter: resolve(projectRoot, 'binary-converter/index.html'),
        hexConverter: resolve(projectRoot, 'hex-converter/index.html'),
        binaryTranslator: resolve(projectRoot, 'binary-translator/index.html'),
        asciiTable: resolve(projectRoot, 'ascii-table/index.html'),
        morseCodeTranslator: resolve(projectRoot, 'morse-code-translator/index.html'),
        wordCounter: resolve(projectRoot, 'word-counter/index.html'),
        characterCounter: resolve(projectRoot, 'character-counter/index.html'),
        esWordCounter: resolve(projectRoot, 'es/contador-de-palabras/index.html'),
        esCharacterCounter: resolve(projectRoot, 'es/contador-de-caracteres/index.html'),
        jaCharacterCounter: resolve(projectRoot, 'ja/character-counter/index.html'),
        koCharacterCounter: resolve(projectRoot, 'ko/character-counter/index.html'),
        urlEncoder: resolve(projectRoot, 'url-encoder/index.html'),
        urlDecoder: resolve(projectRoot, 'url-decoder/index.html'),
        urlParser: resolve(projectRoot, 'url-parser/index.html'),
        queryStringParser: resolve(projectRoot, 'query-string-parser/index.html'),
        hashGenerator: resolve(projectRoot, 'hash-generator/index.html'),
        sha256Generator: resolve(projectRoot, 'sha256-generator/index.html'),
        md5Generator: resolve(projectRoot, 'md5-generator/index.html'),
        fileChecksum: resolve(projectRoot, 'file-checksum/index.html'),
        uuidGenerator: resolve(projectRoot, 'uuid-generator/index.html'),
        uuidV4Generator: resolve(projectRoot, 'uuid-v4-generator/index.html'),
        uuidV7Generator: resolve(projectRoot, 'uuid-v7-generator/index.html'),
        uuidValidator: resolve(projectRoot, 'uuid-validator/index.html'),
        uuidDecoder: resolve(projectRoot, 'uuid-decoder/index.html'),
        jwtDecoder: resolve(projectRoot, 'jwt-decoder/index.html'),
        jwtExpirationChecker: resolve(projectRoot, 'jwt-expiration-checker/index.html'),
        sqlFormatter: resolve(projectRoot, 'sql-formatter/index.html'),
        mysqlSqlFormatter: resolve(projectRoot, 'mysql-sql-formatter/index.html'),
        postgresqlSqlFormatter: resolve(projectRoot, 'postgresql-sql-formatter/index.html'),
        bigquerySqlFormatter: resolve(projectRoot, 'bigquery-sql-formatter/index.html'),
        sqlServerFormatter: resolve(projectRoot, 'sql-server-formatter/index.html'),
        xmlFormatter: resolve(projectRoot, 'xml-formatter/index.html'),
        xmlValidator: resolve(projectRoot, 'xml-validator/index.html'),
        xmlViewer: resolve(projectRoot, 'xml-viewer/index.html'),
        yamlFormatter: resolve(projectRoot, 'yaml-formatter/index.html'),
        yamlValidator: resolve(projectRoot, 'yaml-validator/index.html'),
        yamlViewer: resolve(projectRoot, 'yaml-viewer/index.html'),
        yamlToJson: resolve(projectRoot, 'yaml-to-json/index.html'),
        jsonToYaml: resolve(projectRoot, 'json-to-yaml/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: ['liveparse.com', 'www.liveparse.com'],
  },
  preview: {
    port: 4173,
    allowedHosts: ['liveparse.com', 'www.liveparse.com'],
  },
});
