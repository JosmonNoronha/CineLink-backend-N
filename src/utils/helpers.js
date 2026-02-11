function ok(res, data, meta) {
  const payload = { success: true, data };
  if (meta) payload.meta = meta;
  return res.json(payload);
}

module.exports = { ok };
