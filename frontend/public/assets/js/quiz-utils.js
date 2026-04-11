(function () {
  const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how',
    'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to',
    'was', 'what', 'when', 'where', 'which', 'why', 'with', 'you', 'your'
  ]);

  function stemWord(word) {
    if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
    if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
    if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
    return word;
  }

  function normalizeText(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(text) {
    return normalizeText(text)
      .split(' ')
      .map(stemWord)
      .filter(word => word && !STOP_WORDS.has(word));
  }

  function uniqueTokens(text) {
    return Array.from(new Set(tokenize(text)));
  }

  function keywordOverlapScore(userAnswer, correctAnswer) {
    const userTokens = uniqueTokens(userAnswer);
    const correctTokens = uniqueTokens(correctAnswer);

    if (!userTokens.length || !correctTokens.length) {
      return 0;
    }

    const correctSet = new Set(correctTokens);
    const matches = userTokens.filter(token => correctSet.has(token)).length;
    return matches / Math.max(1, Math.min(userTokens.length, correctTokens.length));
  }

  function bigrams(text) {
    const normalized = normalizeText(text);
    if (normalized.length < 2) {
      return normalized ? [normalized] : [];
    }

    const pairs = [];
    for (let i = 0; i < normalized.length - 1; i += 1) {
      pairs.push(normalized.slice(i, i + 2));
    }
    return pairs;
  }

  function diceCoefficient(left, right) {
    const leftPairs = bigrams(left);
    const rightPairs = bigrams(right);

    if (!leftPairs.length || !rightPairs.length) {
      return 0;
    }

    const rightCounts = new Map();
    rightPairs.forEach(pair => {
      rightCounts.set(pair, (rightCounts.get(pair) || 0) + 1);
    });

    let matches = 0;
    leftPairs.forEach(pair => {
      const count = rightCounts.get(pair) || 0;
      if (count > 0) {
        matches += 1;
        rightCounts.set(pair, count - 1);
      }
    });

    return (2 * matches) / (leftPairs.length + rightPairs.length);
  }

  function isAnswerSimilar(userAnswer, correctAnswer) {
    const normalizedUser = normalizeText(userAnswer);
    const normalizedCorrect = normalizeText(correctAnswer);

    if (!normalizedUser || !normalizedCorrect) {
      return false;
    }

    if (normalizedUser === normalizedCorrect) {
      return true;
    }

    if (normalizedCorrect.includes(normalizedUser) && normalizedUser.length >= 5) {
      return true;
    }

    if (normalizedUser.includes(normalizedCorrect) && normalizedCorrect.length >= 5) {
      return true;
    }

    const overlap = keywordOverlapScore(normalizedUser, normalizedCorrect);
    if (overlap >= 0.7) {
      return true;
    }

    if (overlap >= 0.5 && tokenize(normalizedUser).length >= 3) {
      return true;
    }

    return diceCoefficient(normalizedUser, normalizedCorrect) >= 0.82;
  }

  window.LearnixQuizUtils = {
    isAnswerSimilar,
    normalizeText
  };
}());
