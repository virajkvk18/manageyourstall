import {test,expect} from '@playwright/test';
const action=(page,name)=>page.locator(`[data-action="${name}"]:visible`).first();
const go=async(page,screen)=>page.locator(`[data-action="nav"][data-screen="${screen}"]:visible`).first().click();
const ready=async page=>{await page.goto('/');await expect(page.getByRole('heading',{name:'Let’s make some noise.'})).toBeVisible();};

test('board menu starts locked and shows every supplied item',async({page})=>{
 await ready(page);await expect(page.locator('.menu-locked-banner')).toContainText('Stall setup mode');await expect(page.locator('.product-card')).toHaveCount(22);await expect(page.locator('.product-card:disabled')).toHaveCount(22);
 for(const id of ['veggie-small','peri-peri-large','pizza-veggie','pizza-corn-cheese','fizz-coca-cola','fizz-sprite','fizz-fanta','combo-chips-pizza-fizz'])await expect(page.locator(`[data-action="product"][data-id="${id}"]`)).toBeVisible();
 await expect(page.locator('body')).not.toContainText('₹30');
});
test('stall setup unlocks an item only when a price is saved',async({page})=>{
 await ready(page);await action(page,'admin-menu').click();await page.locator('#pin').fill('1234');await page.locator('#repeat').fill('1234');await action(page,'unlock').click();await expect(page.locator('#sheet')).toContainText('Set stall prices');
 await page.locator('#sheet [data-action="edit-product"][data-id="veggie-small"]').click();await page.locator('#price').fill('30');await action(page,'save-product').click();await action(page,'close').click();
 await expect(page.locator('[data-action="product"][data-id="veggie-small"]')).toBeEnabled();await expect(page.locator('[data-action="product"][data-id="pizza-veggie"]')).toBeDisabled();await page.locator('[data-action="product"][data-id="veggie-small"]').click();await expect(page.locator('.cart-panel')).toContainText('₹30');
});
test('mobile tabs and primary screens have no horizontal overflow',async({page})=>{
 await ready(page);for(const category of ['Crispy Dhamaka','Pizza Pataka','Fizz Pataka','Combo Pataka']){await page.locator(`[data-action="category"][data-category="${category}"]`).click();await expect(page.locator('.menu-caption')).toContainText(category.toUpperCase());expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),category).toBeTruthy();}for(const screen of ['dashboard','orders','milestones','more']){await go(page,screen);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),screen).toBeTruthy();}
});
