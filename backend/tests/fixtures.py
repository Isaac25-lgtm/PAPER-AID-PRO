"""Realistic upstream API payloads (shapes taken from the public Crossref/OpenAlex/PubMed/S2/arXiv APIs)."""

from __future__ import annotations

DOI = "10.1186/s12936-021-03812-x"

CROSSREF_WORK = {
    "DOI": "10.1186/S12936-021-03812-X",
    "title": ["School-based malaria prevention with insecticide-treated nets: a cluster randomised trial"],
    "author": [
        {"given": "Grace", "family": "Namaganda", "ORCID": "http://orcid.org/0000-0002-1825-0097"},
        {"given": "Peter", "family": "Okello"},
        {"given": "Jane", "family": "Smith"},
    ],
    "container-title": ["Malaria Journal"],
    "issued": {"date-parts": [[2021, 6, 15]]},
    "volume": "20",
    "issue": "1",
    "page": "212",
    "type": "journal-article",
    "publisher": "Springer Science and Business Media LLC",
    "is-referenced-by-count": 14,
    "URL": "http://dx.doi.org/10.1186/s12936-021-03812-x",
    "abstract": "<jats:p>Bed net distribution in schools reduced malaria incidence by 31%.</jats:p>",
    "license": [{"URL": "http://creativecommons.org/licenses/by/4.0"}],
}

OPENALEX_WORK = {
    "id": "https://openalex.org/W3171234567",
    "doi": f"https://doi.org/{DOI}",
    "title": "School-based malaria prevention with insecticide-treated nets: a cluster randomised trial",
    "publication_year": 2021,
    "publication_date": "2021-06-15",
    "ids": {
        "pmid": "https://pubmed.ncbi.nlm.nih.gov/34001234",
        "pmcid": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8123456",
    },
    "primary_location": {
        "source": {"display_name": "Malaria Journal", "host_organization_name": "BioMed Central"},
        "landing_page_url": f"https://doi.org/{DOI}",
    },
    "biblio": {"volume": "20", "issue": "1", "first_page": "212", "last_page": "212"},
    "authorships": [{"author": {"display_name": "Grace Namaganda", "orcid": "https://orcid.org/0000-0002-1825-0097"}}],
    "abstract_inverted_index": {"Bed": [0], "nets": [1], "reduced": [2], "malaria": [3], "incidence.": [4]},
    "cited_by_count": 15,
    "open_access": {"is_oa": True},
    "best_oa_location": {
        "pdf_url": "https://malariajournal.biomedcentral.com/counter/pdf/10.1186/s12936-021-03812-x",
        "license": "cc-by",
    },
    "type": "article",
    "keywords": [{"display_name": "Malaria prevention"}],
}

OPENALEX_OTHER = {
    **OPENALEX_WORK,
    "id": "https://openalex.org/W999",
    "doi": "https://doi.org/10.1000/other",
    "title": "Malaria and school absenteeism in East Africa",
    "ids": {},
    "cited_by_count": 300,
    "authorships": [{"author": {"display_name": "Ann Brown"}}],
}

PUBMED_ESEARCH = {"esearchresult": {"idlist": ["34001234"]}}

PUBMED_EFETCH = """<?xml version="1.0"?>
<PubmedArticleSet>
 <PubmedArticle>
  <MedlineCitation>
   <PMID>34001234</PMID>
   <Article>
    <Journal><JournalIssue><Volume>20</Volume><Issue>1</Issue><PubDate><Year>2021</Year><Month>Jun</Month></PubDate>
    </JournalIssue><Title>Malaria journal</Title></Journal>
    <ArticleTitle>School-based malaria prevention with insecticide-treated nets:
     a cluster randomised trial.</ArticleTitle>
    <Pagination><MedlinePgn>212</MedlinePgn></Pagination>
    <Abstract>
     <AbstractText Label="BACKGROUND">Malaria causes school absenteeism.</AbstractText>
     <AbstractText Label="RESULTS">Incidence fell by 31% in intervention schools.</AbstractText>
    </Abstract>
    <AuthorList><Author><LastName>Namaganda</LastName><ForeName>Grace</ForeName></Author></AuthorList>
    <ELocationID EIdType="doi">10.1186/s12936-021-03812-x</ELocationID>
   </Article>
   <KeywordList><Keyword>Malaria</Keyword></KeywordList>
  </MedlineCitation>
  <PubmedData><ArticleIdList><ArticleId IdType="pubmed">34001234</ArticleId>
   <ArticleId IdType="pmc">PMC8123456</ArticleId><ArticleId IdType="doi">10.1186/s12936-021-03812-x</ArticleId>
  </ArticleIdList></PubmedData>
 </PubmedArticle>
</PubmedArticleSet>"""

S2_SEARCH = {
    "data": [
        {
            "paperId": "abc123",
            "title": "School-based malaria prevention with insecticide-treated nets: a cluster randomised trial",
            "abstract": "Bed net distribution in 40 schools reduced malaria incidence by 31 percent.",
            "authors": [{"name": "Grace Namaganda"}],
            "year": 2021,
            "venue": "Malaria Journal",
            "externalIds": {"DOI": DOI, "PubMed": "34001234"},
            "citationCount": 16,
            "isOpenAccess": True,
            "openAccessPdf": {"url": "https://example.org/oa.pdf"},
            "publicationDate": "2021-06-15",
            "journal": {"name": "Malaria Journal", "volume": "20"},
        }
    ]
}

ARXIV_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
 <entry>
  <id>http://arxiv.org/abs/2101.00001v2</id>
  <published>2021-01-01T00:00:00Z</published>
  <title>Modelling malaria transmission with deep learning</title>
  <summary>We model transmission dynamics of malaria using neural networks.</summary>
  <author><name>Lee Ng</name></author>
 </entry>
</feed>"""
