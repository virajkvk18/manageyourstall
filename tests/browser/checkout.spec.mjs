import {test,expect} from '@playwright/test';
const action=(page,a)=>page.locator(`[data-action="${a}"]:visible`).first();
const go=async(page,screen)=>{await page.locator(`[data-action="nav"][data-screen="${screen}"]:visible`).first().click();};
const add=async(page,id)=>{await page.locator(`[data-action="product"][data-id="${id}"]`).click();};
const ready=async(page)=>{await page.goto('/');await expect(page.getByRole('heading',{name:'Let’s make some noise.'})).toBeVisible();};
test('exact festival order, manual UPI, receipt, dashboard and reload',async({page})=>{
 await ready(page);
 await add(page,'small');await page.locator('[name="addons"][value="cheese"]').check();await page.locator('[data-action="custom-qty"][data-delta="1"]').click();await action(page,'add-custom').click();
 await add(page,'large');await page.locator('[name="addons"][value="corn"]').check();await action(page,'add-custom').click();
 await add(page,'lemon');await add(page,'lemon');await action(page,'checkout').click();await action(page,'checkout-promo').click();await expect(page.locator('.checkout-total')).toHaveText('₹160');
 await page.locator('[name="method"][value="UPI"]').check();await action(page,'complete').click();await expect(page.locator('[data-error]')).toContainText('Confirm receipt');
 await page.locator('[name="confirmed"]').check();await action(page,'complete').click();await expect(page.locator('#sheet')).not.toBeVisible();
 await go(page,'orders');await page.locator('[data-action="receipt"]').first().click();await expect(page.locator('#sheet')).toContainText('₹160');await expect(page.locator('#sheet')).toContainText('Cheese Sauce');await expect(page.locator('#sheet')).toContainText('Sweet Corn');await action(page,'close').click();
 await go(page,'dashboard');await expect(page.locator('.big-number')).toHaveText('₹160');await expect(page.locator('.stat').nth(1).locator('strong')).toHaveText('1');await expect(page.locator('.stat').nth(2).locator('strong')).toHaveText('5');await page.reload();await go(page,'dashboard');await expect(page.locator('.big-number')).toHaveText('₹160');
});
test('cart quantities, remove all, disabled unpriced products and safe close',async({page})=>{
 await ready(page);await expect(page.locator('[data-action="product"][data-id="pizza"]')).toBeDisabled();await add(page,'lemon');await action(page,'checkout').click();await action(page,'view-cart').click();await page.locator('#sheet [data-action="qty"][data-delta="1"]').click();await page.locator('#sheet [data-action="qty"][data-delta="1"]').click();await page.locator('#sheet [data-action="qty"][data-delta="-1"]').click();await page.locator('#sheet [data-action="qty"][data-delta="-1"]').click();await expect(page.locator('#sheet .stepper span')).toHaveText('1');await page.keyboard.press('Escape');await page.reload();await action(page,'checkout').click();await expect(page.locator('.checkout-total')).toHaveText('₹20');await action(page,'view-cart').click();await page.locator('#sheet [data-action="remove"]').click();await expect(page.locator('#sheet')).toContainText('Your cart is empty.');await expect(page.locator('#sheet [data-action="checkout"]')).toBeDisabled();
});
test('pending payment does not collect until manually confirmed',async({page})=>{
 await ready(page);await add(page,'masala');await action(page,'checkout').click();await page.locator('[name="method"][value="UPI"]').check();await page.locator('[name="pending"]').check();await action(page,'complete').click();await go(page,'dashboard');await expect(page.locator('.big-number')).toHaveText('₹0');await go(page,'orders');await action(page,'receipt').click();await action(page,'pending-payment').click();await page.locator('[name="confirmed"]').check();await action(page,'mark-paid').click();await go(page,'dashboard');await expect(page.locator('.big-number')).toHaveText('₹30');
});
test('offline reload and checkout after initial shell caching',async({page,context})=>{
 await ready(page);await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();await expect(page.getByRole('heading',{name:'Let’s make some noise.'})).toBeVisible();await context.setOffline(true);await page.reload();await expect(page.getByRole('heading',{name:'Let’s make some noise.'})).toBeVisible();await add(page,'lemon');await action(page,'checkout').click();await action(page,'complete').click();await page.reload();await go(page,'dashboard');await expect(page.locator('.big-number')).toHaveText('₹20');
});
test('no horizontal overflow on any primary screen',async({page})=>{
 await ready(page);for(const name of ['sell','dashboard','orders','milestones','more']){await go(page,name);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}await page.screenshot({path:`test-results/${test.info().project.name}-more.png`,fullPage:true});await go(page,'sell');await page.screenshot({path:`test-results/${test.info().project.name}-sell.png`,fullPage:true});
});
