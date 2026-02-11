/**
 * Test script for watch providers functionality
 * Tests both movie and TV watch providers endpoints
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5001/api';

// Test data - using popular movies/TV shows
const TEST_MOVIE_ID = 550; // Fight Club
const TEST_TV_ID = 1396; // Breaking Bad

async function testWatchProviders() {
  console.log('🧪 Testing Watch Providers Endpoints\n');
  console.log('=' .repeat(60));

  try {
    // Test 1: Movie Watch Providers
    console.log('\n📽️  Test 1: Movie Watch Providers (Fight Club)');
    console.log('-'.repeat(60));
    const movieResponse = await axios.get(`${BASE_URL}/movies/${TEST_MOVIE_ID}/watch-providers`);
    console.log('✅ Status:', movieResponse.status);
    console.log('📊 Response:', JSON.stringify(movieResponse.data, null, 2));
    
    if (movieResponse.data?.data?.results?.US) {
      const usData = movieResponse.data.data.results.US;
      console.log('\n🇺🇸 US Availability:');
      if (usData.flatrate) {
        console.log('  📺 Streaming:', usData.flatrate.map(p => p.provider_name).join(', '));
      }
      if (usData.rent) {
        console.log('  💵 Rent:', usData.rent.map(p => p.provider_name).join(', '));
      }
      if (usData.buy) {
        console.log('  🛒 Buy:', usData.buy.map(p => p.provider_name).join(', '));
      }
    }

    // Test 2: TV Show Watch Providers
    console.log('\n\n📺 Test 2: TV Show Watch Providers (Breaking Bad)');
    console.log('-'.repeat(60));
    const tvResponse = await axios.get(`${BASE_URL}/tv/${TEST_TV_ID}/watch-providers`);
    console.log('✅ Status:', tvResponse.status);
    console.log('📊 Response:', JSON.stringify(tvResponse.data, null, 2));
    
    if (tvResponse.data?.data?.results?.US) {
      const usData = tvResponse.data.data.results.US;
      console.log('\n🇺🇸 US Availability:');
      if (usData.flatrate) {
        console.log('  📺 Streaming:', usData.flatrate.map(p => p.provider_name).join(', '));
      }
      if (usData.rent) {
        console.log('  💵 Rent:', usData.rent.map(p => p.provider_name).join(', '));
      }
      if (usData.buy) {
        console.log('  🛒 Buy:', usData.buy.map(p => p.provider_name).join(', '));
      }
    }

    // Test 3: Cache verification (second request should be faster)
    console.log('\n\n🔄 Test 3: Cache Performance');
    console.log('-'.repeat(60));
    const start1 = Date.now();
    await axios.get(`${BASE_URL}/movies/${TEST_MOVIE_ID}/watch-providers`);
    const time1 = Date.now() - start1;
    
    const start2 = Date.now();
    const cachedResponse = await axios.get(`${BASE_URL}/movies/${TEST_MOVIE_ID}/watch-providers`);
    const time2 = Date.now() - start2;
    
    console.log(`  ⏱️  First request: ${time1}ms`);
    console.log(`  ⚡ Cached request: ${time2}ms`);
    console.log(`  📊 Source: ${cachedResponse.headers['x-source'] || 'unknown'}`);
    
    if (time2 < time1) {
      console.log('  ✅ Cache is working! Cached request was faster.');
    }

    // Test 4: Different regions
    console.log('\n\n🌍 Test 4: Available Regions');
    console.log('-'.repeat(60));
    const allRegions = movieResponse.data?.data?.results || {};
    const regions = Object.keys(allRegions);
    console.log(`  📍 Content available in ${regions.length} regions:`);
    console.log(`     ${regions.join(', ')}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests passed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Test failed!');
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

// Test user subscriptions endpoints (requires authentication)
async function testUserSubscriptions() {
  console.log('\n\n🔐 User Subscriptions Endpoints');
  console.log('=' .repeat(60));
  console.log('ℹ️  Note: These endpoints require authentication');
  console.log('   Test them from the app after signing in');
  console.log('   Endpoints:');
  console.log('   - GET  /api/user/subscriptions');
  console.log('   - PUT  /api/user/subscriptions');
  console.log('=' .repeat(60));
}

// Run tests
console.log('\n🎬 CineLink Watch Providers Test Suite');
console.log('🕐 ' + new Date().toLocaleString());

testWatchProviders()
  .then(() => testUserSubscriptions())
  .then(() => {
    console.log('\n✨ Test suite completed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error.message);
    process.exit(1);
  });
