# External ML Recommendations API

## Overview

The `/recommendations/ml` endpoint provides an **optional alternative** recommendation source using an external machine learning API ([movie-reco-api.onrender.com](https://movie-reco-api.onrender.com)).

> **Note:** This is a supplementary feature. The primary `/recommendations` endpoint using TMDB is faster and recommended for production use.

## Why Use This?

- **Diverse Recommendations**: Uses different ML algorithms (content-based + similarity-based)
- **Alternative Data Source**: Based on MovieLens + Netflix combined dataset
- **Rich Metadata**: Includes recommendation sources breakdown, data quality indicators
- **Experimentation**: Compare TMDB recommendations with content-based filtering results

## Endpoint Details

### Request

```http
POST /api/recommendations/ml
Content-Type: application/json

{
  "titles": ["Inception", "The Matrix"],
  "top_n": 10
}
```

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `titles` | array | Yes | 1-5 movie titles to base recommendations on |
| `top_n` | integer | No | Number of recommendations (1-20, default: 10) |

### Response (Success)

```json
{
  "success": true,
  "data": {
    "recommendations": [
      {
        "title": "The Shawshank Redemption",
        "release_year": "1994",
        "genres": "Crime, Drama",
        "avg_rating": 4.43,
        "rating_count": 317,
        "rating_consistency": "±0.7",
        "description": "A crime, drama featuring themes of prison...",
        "cast": "Unknown",
        "director": "Unknown",
        "source": "MovieLens",
        "data_quality": "verified",
        "ml_rating": 4.43,
        "ml_rating_count": 317,
        "type": "Movie"
      }
    ],
    "found_titles": ["Inception", "The Matrix"],
    "message": "Found 2 titles. Generated 10 recommendations.",
    "processing_time": 0.012,
    "recommendation_sources": {
      "content_based": 5,
      "similarity_based": 3,
      "popular_fallback": 2
    },
    "source": "external_ml_api",
    "note": "First request may take ~60s due to Render cold start"
  }
}
```

### Response (Error)

```json
{
  "success": false,
  "error": "External ML API temporarily unavailable",
  "details": "connect ETIMEDOUT",
  "note": "Use the primary /recommendations endpoint for TMDB-based recommendations"
}
```

## Performance Considerations

### Cold Start Delay
- **First Request**: ~50-60 seconds (Render free tier spins down after inactivity)
- **Subsequent Requests**: <1 second

### Timeout
- Backend timeout: 120 seconds
- Automatically handles cold start scenarios

## Testing

Use the provided test script:

```powershell
# From backend directory
.\test-ml-recommendations.ps1
```

Or test with curl:

```bash
curl -X POST http://localhost:5001/api/recommendations/ml \
  -H "Content-Type: application/json" \
  -d '{"titles": ["Inception"], "top_n": 5}'
```

## Comparison with Primary Endpoint

| Feature | `/recommendations` (TMDB) | `/recommendations/ml` (External) |
|---------|---------------------------|----------------------------------|
| **Speed** | Fast (cached 6 hours) | Slow first request (~60s) |
| **Algorithm** | Collaborative + Content-based | Content + Similarity-based |
| **Data Source** | TMDB database | MovieLens + Netflix |
| **Metadata** | Rich (cast, crew, reviews) | Basic (title, genre, rating) |
| **Reliability** | High (TMDB SLA) | Medium (free tier hosting) |
| **Use Case** | Production | Experimentation |

## When to Use ML Endpoint

✅ **Good for:**
- Comparing different recommendation algorithms
- Research and experimentation
- Accessing MovieLens/Netflix-based ratings
- Getting recommendation source breakdowns

❌ **Not recommended for:**
- Production app features (use TMDB primary endpoint)
- Time-sensitive requests (cold start delay)
- High-frequency calls (no built-in caching)

## Implementation Example

### Frontend (React Native)

```javascript
// Add this to src/services/api.js if needed
export const getMLRecommendations = async (titles, topN = 10) => {
  try {
    console.log("🤖 Getting ML recommendations:", titles);
    const data = await apiClient.post("/recommendations/ml", {
      titles,
      top_n: topN,
    });
    console.log("✅ ML recommendations received");
    return data.recommendations || [];
  } catch (error) {
    console.error("❌ ML recommendations failed:", error.message);
    return [];
  }
};
```

### Usage in Component

```javascript
import { getMLRecommendations } from '../services/api';

// Get recommendations based on multiple favorite movies
const favorites = ['Inception', 'The Matrix', 'Interstellar'];
const recommendations = await getMLRecommendations(favorites, 10);
```

## Notes

- **Optional Feature**: Not integrated into the main app flow
- **No Caching**: Responses are not cached (unlike TMDB endpoint)
- **Rate Limiting**: External API may have rate limits
- **Maintenance**: External API is independently maintained

---

**Recommendation**: Keep using the primary TMDB-based `/recommendations` endpoint for your app. Use this ML endpoint only for special features or comparative analysis.
