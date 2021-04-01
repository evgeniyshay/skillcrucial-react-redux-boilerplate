import express from 'express'
import path from 'path'
import cors from 'cors'
import bodyParser from 'body-parser'
import sockjs from 'sockjs'
import { renderToStaticNodeStream } from 'react-dom/server'
import React from 'react'
import axios from 'axios'

import cookieParser from 'cookie-parser'
import config from './config'
import Html from '../client/html'

const { readFile, writeFile, stat, unlink } = require('fs').promises

require('colors')

let Root

try {
  // eslint-disable-next-line import/no-unresolved
  Root = require('../dist/assets/js/ssr/root.bundle').default
} catch {
  console.log('SSR not found. Please run "yarn run build:ssr"'.red)
}

let connections = []

const port = process.env.PORT || 8090
const server = express()

const middleware = [
  cors(),
  express.static(path.resolve(__dirname, '../dist/assets')),
  bodyParser.urlencoded({ limit: '50mb', extended: true, parameterLimit: 50000 }),
  bodyParser.json({ limit: '50mb', extended: true }),
  cookieParser()
]

middleware.forEach((it) => server.use(it))

const [htmlStart, htmlEnd] = Html({
  body: 'separator',
  title: 'Skillcrucial'
}).split('separator')

server.get('/', (req, res) => {
  const appStream = renderToStaticNodeStream(<Root location={req.url} context={{}} />)
  res.write(htmlStart)
  appStream.pipe(res, { end: false })
  appStream.on('end', () => {
    res.write(htmlEnd)
    res.end()
  })
})

const dataFile = `${__dirname}/../database/users.json`
const serverUrl = 'https://jsonplaceholder.typicode.com/users'

const apiPath = '/api/v1'
const usersRoute = `${apiPath}/users`

const loginMethod = (req, res, next) => {
  res.set('x-skillcrucial-user', '1fcc2edd-ccb1-461a-9070-039969bae1be');
  res.set('Access-Control-Expose-Headers', 'X-SKILLCRUCIAL-USER')

  next()
}

const getData = async () => {
  const result = await axios(serverUrl).then(({ data }) => data)

  return result
}

const checkFile = async () => {
  const data = await stat(dataFile)

  return data
}

const readData = async () => {
  const data = await readFile(dataFile, { encoding: 'utf8' })

  return data
}

const writeData = async (newData) => {
  const data = await writeFile(dataFile, JSON.stringify(newData), { encoding: 'utf8' })

  return data
}

const deleteFile = async () => {
  const data = await unlink(dataFile)

  return data
}

const checkDataFile = async () => {
  await checkFile().catch(async () => {
    const newData = await getData()

    writeData(newData)
  })
}

server.get(usersRoute, loginMethod, async (req, res) => {
  await checkDataFile()

  readData()
    .then((text) => {
      res.json(JSON.parse(text))
    })
    .catch((err) => {
      res.json({ status: 'error', error: err })
    })
})

server.get(`${usersRoute}/:id`, loginMethod, async (req, res) => {
  await checkDataFile()

  readData()
    .then((text) => {
      const userData = JSON.parse(text).filter((user) => user.id === Number(req.params.id))

      if (userData.length) {
        res.json(userData)
      } else {
        res.json({ status: 'error', errorText: 'There are no users with such ID!' })
      }
    })
    .catch((err) => {
      res.json({ status: 'error', error: err })
    })
})

server.post(usersRoute, loginMethod, async (req, res) => {
  await checkDataFile()

  const users = await readData()
    .then((text) => JSON.parse(text))
    .catch((err) => {
      res.json({ status: 'error', error: err })
    })

  const userID = users.length + 1
  const newData = { ...{ id: userID }, ...req.body }

  writeData([...users, newData])
    .then(() => {
      res.json({ status: 'success', id: userID })
    })
    .catch((err) => {
      res.json({ status: 'error', error: err })
    })
})

server.patch(`${usersRoute}/:id`, loginMethod, async (req, res) => {
  await checkDataFile()

  const userID = Number(req.params.id)

  const usersData = await readData()
    .then((text) => {
      return JSON.parse(text).map((user) => (user.id === userID ? { ...user, ...req.body } : user))
    })
    .catch((err) => {
      res.json({ status: 'error', error: err })
    })

  writeData(usersData)
    .then(() => {
      res.json({ status: 'success', id: userID })
    })
    .catch((err) => {
      res.json({ status: 'error', error: err })
    })
})

server.delete(`${usersRoute}/:id`, loginMethod, async (req, res) => {
  await checkDataFile()

  const userID = Number(req.params.id)

  const users = await readData()
    .then((text) => JSON.parse(text).filter((user) => user.id !== userID))
    .catch((err) => {
      res.json({ status: 'error', error: err })
    })

  writeData(users)
    .then(() => {
      res.json({ status: 'success', id: userID })
    })
    .catch((err) => {
      res.json({ status: 'error', error: err })
    })
})

server.delete(usersRoute, loginMethod, (req, res) => {
  deleteFile()
    .then(() => {
      res.json({ status: 'success' })
    })
    .catch((err) => {
      res.json({ status: 'error', error: err })
    })
})

server.use('/api/', (req, res) => {
  res.status(404)
  res.end()
})

server.get('/*', (req, res) => {
  const appStream = renderToStaticNodeStream(<Root location={req.url} context={{}} />)
  res.write(htmlStart)
  appStream.pipe(res, { end: false })
  appStream.on('end', () => {
    res.write(htmlEnd)
    res.end()
  })
})

const app = server.listen(port)

if (config.isSocketsEnabled) {
  const echo = sockjs.createServer()
  echo.on('connection', (conn) => {
    connections.push(conn)
    conn.on('data', async () => {})

    conn.on('close', () => {
      connections = connections.filter((c) => c.readyState !== 3)
    })
  })
  echo.installHandlers(app, { prefix: '/ws' })
}
console.log(`Serving at http://localhost:${port}`)
