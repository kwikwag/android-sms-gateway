#!/usr/bin/env node
import fs from 'fs';import {spawnSync} from 'child_process';import readline from 'readline';
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=(q)=>new Promise(r=>rl.question(q,r));
const run=(cmd,args)=>{console.log(`$ ${cmd} ${args.join(' ')}`);return spawnSync(cmd,args,{stdio:'inherit'});};
if(spawnSync('firebase',['--version']).status!==0){console.log('Firebase CLI not installed. Install: npm install -g firebase-tools');process.exit(1)}
console.log('Checking firebase login...');
if(spawnSync('firebase',['login:list'],{stdio:'ignore'}).status!==0){console.log('Please run firebase login first.');process.exit(1)}
const project=await ask('Firebase project id: ');
const confirm=await ask(`Use project ${project}? (y/N): `);if(confirm.toLowerCase()!=='y') process.exit(0);
run('firebase',['use',project]);
console.log('Firestore rules/index files are in firebase-agent/. Deploy manually:');
console.log('firebase deploy --only firestore:rules,firestore:indexes');
const check=await ask('Check app/google-services.json exists now? (y/N): ');
if(check.toLowerCase()==='y'){console.log(fs.existsSync('app/google-services.json')?'Found app/google-services.json':'Missing app/google-services.json')}
console.log('\nChecklist:\n1) Enable Authentication (Anonymous or Email/Password).\n2) Create Firestore DB in production mode.\n3) Deploy rules and indexes.\n4) Add Android app and download google-services.json.');
rl.close();
