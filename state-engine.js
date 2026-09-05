// state-engine.js — turns raw clock numbers into a plain-language read on
// the opponent's pace. This is a rule-based heuristic over move timing and
// remaining time, not a prediction of what the opponent is thinking — it
// says so in the UI so it isn't mistaken for more than it is.

window.COS = window.COS || {};

window.COS.evaluateState = function evaluateState({ remaining, baseline, moveDurations }) {
  const timePct = baseline > 0 ? (remaining / baseline) * 100 : 100;
  const recent = moveDurations.slice(-3);
  const avg = moveDurations.length ? moveDurations.reduce((a, b) => a + b, 0) / moveDurations.length : null;
  const last = moveDurations.length ? moveDurations[moveDurations.length - 1] : null;

  if (moveDurations.length < 2 || avg == null || last == null) {
    return { key: "gathering", label: "بصدد الرصد…", detail: "بحاجة لعدة نقلات لتكوين قراءة موثوقة." };
  }

  const ratio = last / Math.max(avg, 0.5);

  if (timePct < 15 && last > avg * 0.5) {
    return {
      key: "time-trouble",
      label: "في ضائقة وقت",
      detail: `تبقّى له نحو ${Math.round(timePct)}% من رصيده الأصلي وما زال يفكّر طويلاً — فرصة لتعقيد اللعب.`,
    };
  }

  if (ratio <= 0.4 && last < 5) {
    return {
      key: "rushing",
      label: "يلعب بسرعة متسرّعة",
      detail: "نقلاته الأخيرة أسرع بكثير من معدّله — قد يكون في نقلات محفوظة أو تحت ضغط.",
    };
  }

  if (ratio >= 1.8) {
    return {
      key: "deep-think",
      label: "تركيز عميق",
      detail: "يفكّر أطول من معتاده بكثير في هذه النقلة — على الأرجح موقف صعب بالنسبة له.",
    };
  }

  if (timePct > 55 && ratio > 0.7 && ratio < 1.3) {
    return {
      key: "calm",
      label: "هادئ ومتحكم",
      detail: "وتيرة نقلاته ثابتة ورصيد وقته مريح — لا توجد إشارة ضغط واضحة حالياً.",
    };
  }

  return {
    key: "steady",
    label: "وتيرة طبيعية",
    detail: "لا توجد إشارة واضحة على تسرّع أو ضغط في الوقت الحالي.",
  };
};
