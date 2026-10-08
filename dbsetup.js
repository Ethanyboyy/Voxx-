#!/usr/bin/env node

const { spawn } = require('node:child_process')

const env = { ...process.env }

;(async() => {

  // prepare database
  await exec('npx prisma migrate deploy')
  await exec('npx next build --experimental-build-mode generate')

  // launch application
  if (process.env.BUCKET_NAME) {
    await exec(`npx litestream replicate -config litestream.yml -exec ${JSON.stringify(process.argv.slice(2).join(' '))}`)
  } else {
    await exec(process.argv.slice(2).join(' '))
  }
})()

function exec(command) {
  const child = spawn(command, { shell: true, stdio: 'inherit', env })
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} failed rc=${code}`))
      }
    })
  })
}
