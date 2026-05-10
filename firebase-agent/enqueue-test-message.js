#!/usr/bin/env node
import readline from 'readline';
import admin from 'firebase-admin';
if(!admin.apps.length) admin.initializeApp();
const db=admin.firestore();
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=(q)=>new Promise(r=>rl.question(q,r));
const to=await ask('Phone number: '); const body=await ask('Message: '); const simSlot=await ask('SIM slot (optional): ');
const ref=await db.collection('sms_jobs').add({to,body,status:'queued',createdAt:admin.firestore.FieldValue.serverTimestamp(),claimedAt:null,claimedBy:null,sentAt:null,failedAt:null,error:null,simSlot:simSlot?Number(simSlot):null,idempotencyKey:null,attemptCount:0});
console.log('Created job',ref.id); rl.close();
