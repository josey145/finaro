const express = require('express');
const router = express.Router();
const publicController = require('../controllers/public.controller');

console.log('publicController loaded:', publicController);
console.log('publicController.home:', typeof publicController.home);

router.get('/', publicController.home);
router.get('/products', publicController.home);
router.get('/solutions', publicController.solutions);
router.get('/about', publicController.about);
router.get('/pricing', publicController.pricing);
router.get('/policy', publicController.policy);

router.get('/demo', publicController.demo);        // NEW
router.get('/contact', publicController.contact);  // NEW
router.get('/support', publicController.support);  // NEW
router.get('/status', publicController.status); 



module.exports = router;