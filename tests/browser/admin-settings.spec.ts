import {test,expect} from '@playwright/test';
import {writeFile,mkdir} from 'node:fs/promises';
test('admin JEV changes require a review note and signed action; disabled JEV retains local filtering',async({page})=>{
 await mkdir('artifacts',{recursive:true});
 await writeFile('artifacts/admin-settings-ui.html',`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
 import React from 'react';import {createRoot} from 'react-dom/client';import {Admin} from '../src/App.tsx';import '../src/styles.css';
 window.adminCalls=[];createRoot(document.getElementById('root')).render(React.createElement('main',{},React.createElement(Admin,{user:{address:'0x0000000000000000000000000000000000000001',admin:true},busy:false,run:fn=>fn(),mutate:async(...args)=>{window.adminCalls.push(args);window.jevOn=args[3].enabled;}})));
 </script></body></html>`);
 await page.route('**/api/admin',async route=>route.fulfill({json:{members:[],reports:[],giveaways:[],actions:[],settings:{jevEnabled:await page.evaluate(()=>(window as any).jevOn!==false),revision:4}}}));
 await page.goto('/artifacts/admin-settings-ui.html');
 await page.getByRole('button',{name:'Turn off JEV',exact:true}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('button',{name:'Sign and apply'})).toBeDisabled();
 await dialog.getByLabel('Reason for this change').fill('Temporarily use local filtering.');
 await dialog.getByRole('button',{name:'Sign and apply'}).click();
 await expect(page.getByText('JEV is off. The local content filter is active.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).adminCalls[0])).toEqual(['set-jev','jev_enabled',4,{enabled:false,reason:'Temporarily use local filtering.'}]);
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Turn on JEV',exact:true}).click();
 await expect(dialog.getByText('New saves will pass both the local filter and JEV review.')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'artifacts/admin-review-setting-mobile.png',fullPage:true});
});
