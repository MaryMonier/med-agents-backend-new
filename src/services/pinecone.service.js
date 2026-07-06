const { Pinecone } = require('@pinecone-database/pinecone');
const { PINECONE_API_KEY } = require('../config/env');
const { getEmbedding } = require('./embedding.service');

const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });

const INDEX_NAME = 'med-agents';

const upsertVectors = async (vectors) => {
  const index = pinecone.index(INDEX_NAME);
  await index.upsert(vectors);
};

const searchSimilar = async (query, topK = 3) => {
  try {
    const queryEmbedding = await getEmbedding(query);
    const index = pinecone.index(INDEX_NAME);
    const results = await index.query({
      vector: queryEmbedding,
      topK,
      includeMetadata: true,
    });
    return results.matches || [];
  } catch (error) {
    console.error('Pinecone search error:', error.message);
    return [];
  }
};

const retrieve = async (query, language = 'en', topK = 3) => {
  try {
    const matches = await searchSimilar(query, topK);
    return matches.map(match => ({
      topic: match.metadata?.topic,
      content: match.metadata?.content,
      score: match.score,
    }));
  } catch (error) {
    console.error('Retrieve error:', error.message);
    return [];
  }
};

const formatContext = (docs, language = 'en') => {
  if (!docs || docs.length === 0) {
    return language === 'ar' ? 'لا توجد معلومات متاحة' : 'No relevant context found';
  }
  return docs.map((doc, i) => `[Source ${i + 1}] ${doc.content}`).join('\n\n');
};

module.exports = { getEmbedding, upsertVectors, searchSimilar, retrieve, formatContext };