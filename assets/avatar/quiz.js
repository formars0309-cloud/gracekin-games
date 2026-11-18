import { JOBS } from './model.js';
import { questions, jobDescriptions, scoreJourney } from './quiz-story.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, action, primary = false) {
  const node = element('button', primary ? 'avq-primary' : 'avq-button', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

// 편집 중인 캐릭터에 직업 ID를 전달한 뒤 닫는다. 저장 여부는 편집 화면에서 결정한다.
export function mountJobQuiz(container, { onRecommend, onClose } = {}) {
  if (!document.querySelector('link[data-avatar-quiz-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./quiz.css', import.meta.url).href;
    style.dataset.avatarQuizStyle = '';
    document.head.append(style);
  }
  const opener = document.activeElement;
  const root = element('section', 'avq');
  root.setAttribute('aria-label', '별등대 직업 이야기');
  container.replaceChildren(root);
  const answers = [];
  let step = 0;

  function close() {
    root.remove();
    onClose?.();
    if (opener?.isConnected && document.activeElement === document.body) opener.focus();
  }

  function render() {
    const finished = step === questions.length;
    const heading = element('h2', 'avq-title', finished ? '나에게 어울리는 직업' : questions[step].title);
    heading.tabIndex = -1;
    if (!finished) heading.setAttribute('aria-label', `${questions.length}개 장면 중 ${step + 1}번째, ${questions[step].title}`);
    const header = element('div', 'avq-header');
    header.append(element('span', 'avq-step', finished ? '별등대 여정 완료' : `별등대 여정 · ${step + 1} / ${questions.length}`), button('닫기', close));
    const progress = element('progress', 'avq-progress');
    progress.max = questions.length;
    progress.value = finished ? questions.length : step + 1;
    progress.setAttribute('aria-label', '이야기 진행도');
    root.replaceChildren(header, progress, heading);
    if (finished) renderResult();
    else renderQuestion();
    heading.focus();
  }

  function renderQuestion() {
    const scene = questions[step];
    const form = element('form', 'avq-form');
    const field = element('fieldset', 'avq-field');
    field.append(element('legend', 'avq-story', scene.prompt));
    const choices = element('div', 'avq-choices');
    const next = element('button', 'avq-primary', step + 1 === questions.length ? '추천 직업 보기' : '다음 장면');
    next.type = 'submit';
    next.disabled = !answers[step];
    for (const [job, text] of Object.entries(scene.choices)) {
      const label = element('label', 'avq-choice');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'avq-answer';
      radio.value = job;
      radio.required = true;
      radio.checked = answers[step] === job;
      radio.addEventListener('change', () => {
        answers[step] = job;
        next.disabled = false;
      });
      label.append(radio, element('span', '', text));
      choices.append(label);
    }
    field.append(choices);
    const nav = element('div', 'avq-actions');
    if (step > 0) nav.append(button('이전 장면', previous));
    nav.append(next);
    form.append(field, nav);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (answers[step]) {
        step += 1;
        render();
      }
    });
    root.append(form);
  }

  function previous() {
    step -= 1;
    render();
  }

  function renderResult() {
    const { job, scores, tied } = scoreJourney(answers);
    const label = JOBS.find(item => item.id === job).label;
    root.append(element('h3', 'avq-job', label), element('p', 'avq-description', jobDescriptions[job]));
    root.append(element('h4', 'avq-evidence-title', '내가 고른 행동'));
    const evidence = element('ul', 'avq-evidence');
    for (const [index, answer] of answers.entries()) {
      if (answer === job && evidence.childElementCount < 2) {
        evidence.append(element('li', '', `${questions[index].title} — ${questions[index].choices[job]}`));
      }
    }
    root.append(evidence);
    const breakdown = JOBS.map(item => `${item.label} ${scores[item.id]}표`).join(' · ');
    const rule = tied.length > 1
      ? '가장 많은 표를 받은 직업이 여럿이라, 그중 이야기에서 가장 먼저 고른 직업을 추천해요.'
      : '한 장면에 한 표씩, 가장 자주 고른 행동에 해당하는 직업을 추천해요.';
    root.append(element('p', 'avq-counts', breakdown), element('p', 'avq-rule', rule));
    const nav = element('div', 'avq-actions');
    nav.append(button('이전 장면', previous), button('처음부터 다시', () => {
      step = 0;
      answers.length = 0;
      render();
    }), button(`${label} 적용`, () => {
      onRecommend?.(job);
      close();
    }, true));
    root.append(nav);
  }

  render();
  return () => root.remove();
}
