const bcrypt = require('bcryptjs');

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=[\]{};':"\\|,.<>/?]).{8,}$/;

function validateStrength(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Senha é obrigatória');
  }

  if (!PASSWORD_REGEX.test(password)) {
    throw new Error('Senha deve ter pelo menos 8 caracteres, com letra maiúscula, letra minúscula, número e símbolo');
  }
}

async function validateReuse(newPassword, user = {}) {
  const history = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
  const hashesToCheck = [];

  if (user.password) {
    hashesToCheck.push(user.password);
  }

  // Limita a verificação aos 3 hashes mais recentes
  hashesToCheck.push(...history.slice(0, 3));

  for (const hash of hashesToCheck) {
    if (hash && await bcrypt.compare(newPassword, hash)) {
      throw new Error('Senha já utilizada recentemente');
    }
  }
}

function isPasswordExpired(user) {
  if (!user || !user.lastPasswordChange) {
    return true;
  }
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const lastChange = new Date(user.lastPasswordChange).getTime();
  if (Number.isNaN(lastChange)) {
    return true;
  }
  return (Date.now() - lastChange) > ninetyDaysMs;
}

module.exports = {
  validateStrength,
  validateReuse,
  isPasswordExpired
};
