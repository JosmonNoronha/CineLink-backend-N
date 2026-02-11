const { Router } = require('express');

const health = require('./health');
const status = require('./status');
const analytics = require('./analytics');
const movies = require('./movies');
const tv = require('./tv');
const search = require('./search');
const trending = require('./trending');
const recommendations = require('./recommendations');

const router = Router();

router.use('/health', health);
router.use('/status', status);
router.use('/analytics', analytics);
router.use('/movies', movies);
router.use('/tv', tv);
router.use('/search', search);
router.use('/trending', trending);
router.use('/recommendations', recommendations);
router.use('/user', (req, res, next) => {
  // Lazy-load to keep cold start fast (firebase-admin is heavy).
  const user = require('./user');
  return user(req, res, next);
});

module.exports = router;
