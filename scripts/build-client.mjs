import { readFile, writeFile } from 'node:fs/promises'
import { createClientPlugin } from '../lib/client/index.js'
import { createChannelDefinitions } from '../lib/client/channel.js'
import { createWorkspacePage } from '../lib/client/workspace.js'
import { workspaceStyles } from '../lib/client/workspace-style.js'

// Reuse tsc output: no tsdown dependency or duplicate React. DSH owns the loader/React.
const en = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8')).panel
const zh = JSON.parse(await readFile(new URL('../locale/zh.json', import.meta.url), 'utf8')).panel
const source = `window.__ModuleLoader__.load({id:'dsh-superagent',factory(require){const React=require('react');return (${createClientPlugin.toString()})(React,${JSON.stringify({ en, zh })},(${createChannelDefinitions.toString()})(),(${createWorkspacePage.toString()}),(${workspaceStyles.toString()}));}});\n`
await writeFile(new URL('../lib/client.js', import.meta.url), source)
console.log('DSH client factory built: lib/client.js')
