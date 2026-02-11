const { AppError } = require('../utils/errors');

function validate({ body, query, params }) {
  return (req, _res, next) => {
    try {
      if (body) {
        const { value, error } = body.validate(req.body, { abortEarly: false, stripUnknown: true });
        if (error) throw new AppError('Validation error', 400, 'VALIDATION_ERROR', error.details);
        req.body = value;
      }
      if (query) {
        const { value, error } = query.validate(req.query, { abortEarly: false, stripUnknown: true });
        if (error) throw new AppError('Validation error', 400, 'VALIDATION_ERROR', error.details);
        req.query = value;
      }
      if (params) {
        const { value, error } = params.validate(req.params, { abortEarly: false, stripUnknown: true });
        if (error) throw new AppError('Validation error', 400, 'VALIDATION_ERROR', error.details);
        req.params = value;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { validate };
