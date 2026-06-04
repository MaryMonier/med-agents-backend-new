const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');
const { PINECONE_API_KEY, OPENAI_API_KEY } = require('../config/env');

const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const INDEX_NAME = 'med-agents';

const getEmbedding = async (text) => {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
};

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

module.exports = { getEmbedding, upsertVectors, searchSimilar };











