const _ = require('lodash');
const { filterAndTransform } = require('./filter-and-transform');
const { logWarnings } = require('./log-warnings');
const { renderFeaturesResponse } = require('./render-features');
const { renderStatisticsResponse } = require('./render-statistics');
const { renderPrecalculatedStatisticsResponse } = require('./render-precalculated-statistics');
const { renderCountAndExtentResponse } = require('./render-count-and-extent');
const { getGeometryTypeFromGeojson } = require('../helpers');
const { validate } = require('./validate-query-request-parameters');

function query (json, requestParams = {}) {
  const {
    features,
    filtersApplied: {
      all: skipFiltering
    } = {}
  } = json;

  validate(requestParams);

  const { f: requestedFormat } = requestParams;

  // TODO: if format PBF, need to send pbf if only count requested
  if (shouldRenderPrecalculatedData(json, requestParams)) {
    return renderPrecalculatedData(json, requestParams);
  }

  const data = (skipFiltering || !features) ? json : filterAndTransform(json, requestParams);

  if(shouldLogWarnings(requestParams)) {
    logWarnings(data, requestedFormat, requestParams.outFields);
  }
  

  // TODO: Bug when count or extent requested.
  // QUESTION: Is this problematic if its an aggregation with stats?
  if (requestedFormat === 'geojson') {
    return {
      type: 'FeatureCollection',
      features: data.features
    };
  }

  return renderGeoservicesResponse(data, {
    ...requestParams,
    attributeSample: _.get(json, 'features[0].properties'),
    geometryType: getGeometryTypeFromGeojson(json)
  });
}

function shouldLogWarnings(requestParams) {
  const { returnCountOnly, returnExtentOnly, returnIdsOnly } = requestParams;
  
  return !(returnCountOnly || returnExtentOnly || returnIdsOnly);
}

function shouldRenderPrecalculatedData (json, requestParameters) {
  const { statistics, count, extent } = json;
  const { returnCountOnly, returnExtentOnly } = requestParameters;

  return !!statistics || (returnCountOnly === true && count !== undefined) || (returnExtentOnly === true && extent && !returnCountOnly);
}

function renderPrecalculatedData (data, {
  returnCountOnly,
  returnExtentOnly,
  outStatistics,
  groupByFieldsForStatistics
}) {
  const { statistics, count, extent } = data;

  if (statistics) {
    return renderPrecalculatedStatisticsResponse(data, { outStatistics, groupByFieldsForStatistics });
  }

  const retVal = {};

  // TODO: if only count, and f=pbf need to encode response
  if (returnCountOnly) {
    retVal.count = count;
  }

  if (returnExtentOnly) {
    retVal.extent = extent;
  }

  return retVal;
}

function renderGeoservicesResponse (data, params = {}) {
  const {
    returnCountOnly,
    returnExtentOnly,
    returnIdsOnly,
    outSR
  } = params;

  // TODO: if only count, and f=pbf need to encode response
  if (returnCountOnly || returnExtentOnly) {
    return renderCountAndExtentResponse(data, {
      returnCountOnly,
      returnExtentOnly,
      outSR
    });
  }

  if (returnIdsOnly) {
    return renderIdsOnlyResponse(data);
  }

  if (data.statistics) {
    return renderStatisticsResponse(data, params);
  }

  return renderFeaturesResponse(data, params);
}

function renderIdsOnlyResponse ({ features = [], metadata = {} }) {
  const objectIdFieldName = metadata.idField || 'OBJECTID';

  const objectIds = features.map(({ attributes }) => {
    return attributes[objectIdFieldName];
  });

  return {
    objectIdFieldName,
    objectIds
  };
}

module.exports = query;
