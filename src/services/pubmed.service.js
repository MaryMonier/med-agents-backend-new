const axios = require('axios');

const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const searchPubMed = async (query, maxResults = 3) => {
  try {
    const searchRes = await axios.get(`${BASE_URL}/esearch.fcgi`, {
      params: {
        db: 'pubmed',
        term: `${query} treatment clinical`,
        retmax: maxResults,
        retmode: 'json',
        sort: 'relevance',
      }
    });

    const ids = searchRes.data.esearchresult.idlist;
    console.log('PubMed IDs found:', ids);
    if (!ids || ids.length === 0) return [];

    const fetchRes = await axios.get(`${BASE_URL}/efetch.fcgi`, {
      params: {
        db: 'pubmed',
        id: ids.join(','),
        retmode: 'xml',
        rettype: 'abstract',
      }
    });

    return parsePubMedXML(fetchRes.data, ids);

  } catch (error) {
    console.error('PubMed API error:', error.message);
    return [];
  }
};

const parsePubMedXML = (xmlData, ids) => {
  try {
    const articles = [];
    const titleMatches = xmlData.match(/<ArticleTitle>(.*?)<\/ArticleTitle>/g) || [];
    const abstractMatches = xmlData.match(/<AbstractText.*?>(.*?)<\/AbstractText>/g) || [];

    titleMatches.forEach((titleTag, index) => {
      const title = titleTag.replace(/<\/?ArticleTitle>/g, '').trim();
      const abstractTag = abstractMatches[index] || '';
      const abstract = abstractTag.replace(/<AbstractText.*?>|<\/AbstractText>/g, '').trim();

      if (title) {
        articles.push({
          id: ids[index] || index,
          title,
          abstract: abstract || 'No abstract available',
          source: `https://pubmed.ncbi.nlm.nih.gov/${ids[index]}/`,
        });
      }
    });

    return articles;
  } catch (error) {
    return [];
  }
};

const formatPubMedContext = (articles) => {
  if (!articles || articles.length === 0) return 'No clinical guidelines found.';

  return articles.map((article, i) => `
[Guideline ${i + 1}]
Title: ${article.title}
Summary: ${article.abstract}
Source: ${article.source}
  `).join('\n---\n');
};

module.exports = { searchPubMed, formatPubMedContext };