const { promisify } = require('util');
const hasher = require('@sindresorhus/fnv1a');

const before = (req, callback) => { callback(); };
const after = (req, data, callback) => { callback(null, data); };

module.exports = function createModel ({ ProviderModel, koop, namespace }, options = {}) {
  class Model extends ProviderModel {
    #cache;
    #cacheTtl;
    #before;
    #after;
    #cacheRetrieve;
    #cacheInsert;
    #getProviderData;
    #getLayer;
    #getCatalog;

    constructor (koop, options) {

      super(koop, options);
      // Provider constructor's may assign values to this.cache
      this.#cacheTtl = options.cacheTtl;
      this.#cache = this.cache || options.cache || koop.cache;
      this.namespace = namespace;
      this.logger = koop.log;
      this.#before = promisify(options.before || before);
      this.#after = promisify(options.after || after);
      this.#cacheRetrieve = promisify(this.#cache.retrieve).bind(this.#cache);
      this.#cacheInsert = promisify(this.#cache.insert).bind(this.#cache);
      this.#getProviderData = promisify(this.getData).bind(this);
      this.#getLayer = this.getLayer ? promisify(this.getLayer).bind(this) : undefined;
      this.#getCatalog = this.getCatalog ? promisify(this.getCatalog).bind(this) : undefined;
    }

    async pull (req, callback) {
      const key = this.#createCacheKey(req);

      try {
        const cached = await this.#cacheRetrieve(key, {});
        if (shouldUseCache(cached)) {
          return callback(null, cached);
        }
      } catch (err) {
        this.logger.debug(err);
      }
      
      try {
        await this.#before(req);
        const providerGeojson = await this.#getProviderData(req);
        const afterFuncGeojson = await this.#after(req, providerGeojson);
        const { ttl = this.#cacheTtl } = afterFuncGeojson;
        if (ttl) {
          this.#cacheInsert(key, afterFuncGeojson, { ttl });
        }
        callback(null, afterFuncGeojson);
      } catch (err) {
        callback(err);
      }
    }

    // TODO: the pullLayer() and the pullCatalog() are very similar to the pull()
    // function. We may consider to merging them in the future.
    async pullLayer (req, callback) {
      if (!this.#getLayer) {
        callback(new Error(`getLayer() method is not implemented in the ${this.namespace} provider.`));
      }

      const key = `${this.#createCacheKey(req)}::layer`;

      try {
        const cached = await this.#cacheRetrieve(key, req.query);
        if (shouldUseCache(cached)) {
          return callback(null, cached);
        }
      } catch (err) {
        this.logger.debug(err);
      }

      try {
        const data = await this.#getLayer(req);
        const ttl = data.ttl || this.#cacheTtl;
        if (ttl) {
          this.#cacheInsert(key, data, { ttl });
        }
        callback(null, data);
      } catch (err) {
        callback(err);
      }
    }

    async pullCatalog (req, callback) {
      if (!this.#getCatalog) {
        callback(new Error(`getCatalog() method is not implemented in the ${this.namespace} provider.`));
      }

      const key = `${this.#createCacheKey(req)}::catalog`;

      try {
        const cached = await this.#cacheRetrieve(key, req.query);
        if (shouldUseCache(cached)) {
          return callback(null, cached);
        }
      } catch (err) {
        this.logger.debug(err);
      }

      try {
        const data = await this.#getCatalog(req);
        const ttl = data.ttl || this.#cacheTtl;
        if (ttl) {
          this.#cacheInsert(key, data, { ttl });
        }
        callback(null, data);
      } catch (err) {
        callback(err);
      }
    }

    async pullStream (req) {
      if (this.getStream) {
        await this.#before(req);
        const providerStream = await this.getStream(req);
        return providerStream;
      } else {
        throw new Error('getStream() function is not implemented in the provider.');
      }
    }

    #createCacheKey (req) {
      const providerKeyGenerator = this.createCacheKey || this.createKey;
      if (providerKeyGenerator) {
        return providerKeyGenerator(req);
      }
      return hasher(req.url).toString();
    }
  }

  // Add auth methods if auth plugin registered with Koop
  if (koop._authModule) {
    const {
      authenticationSpecification,
      authenticate,
      authorize
    } = koop._authModule;

    Model.prototype.authenticationSpecification = Object.assign({}, authenticationSpecification(namespace), { provider: namespace });
    Model.prototype.authenticate = authenticate;
    Model.prototype.authorize = authorize;
  }
  return new Model(koop, options);
};



function shouldUseCache (cacheEntry) {
  // older cache plugins stored expiry time explicitly; all caches should move to returning empty if expired
  if (!cacheEntry) {
    return false;
  }

  const { expires } = cacheEntry?._cache || cacheEntry?.metadata || {};
  if (!expires) {
    return true;
  }
  
  return Date.now() < expires;
}
