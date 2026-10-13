// emojiPicker.js
export function setupEmojiPicker(buttonSelector, inputSelector) {
  const button = document.querySelector(buttonSelector);
  const input = document.querySelector(inputSelector);
  if (!button || !input) return;

  // Create picker container
  let picker = document.createElement('div');
  picker.className = 'emoji-picker';
  picker.style.position = 'absolute';
  picker.style.background = 'var(--bg-card)';
  picker.style.border = '1px solid var(--border)';
  picker.style.boxShadow = 'var(--shadow-soft)';
  picker.style.padding = '5px';
  picker.style.borderRadius = '6px';
  picker.style.display = 'none';
  picker.style.flexWrap = 'wrap';
  picker.style.width = '200px';
  picker.style.zIndex = '1000';
  picker.style.fontSize = '1.3em';
  document.body.appendChild(picker);

  const emojis = ['💼','🍽️','🛒','💡','🏠','🚗','✈️','🎬','💰','💵','⚕️','🛍️','🐾','🧒','🎁','📚','🧾','🚴‍♂️','🪙','📱','🎉','🧠','🪜','💳','🧊'];

  picker.innerHTML = emojis.map(e => `<span class="emoji-option">${e}</span>`).join('');

  const updatePosition = () => {
    const rect = button.getBoundingClientRect();
    picker.style.left = `${rect.left}px`;
    picker.style.top = `${rect.bottom + window.scrollY + 5}px`;
  };

  button.addEventListener('click', e => {
    e.preventDefault();
    updatePosition();
    picker.style.display = picker.style.display === 'none' ? 'flex' : 'none';
  });

  picker.querySelectorAll('.emoji-option').forEach(span => {
    span.addEventListener('click', e => {
      input.value = e.target.textContent;
      picker.style.display = 'none';
    });
  });

  document.addEventListener('click', e => {
    if (!picker.contains(e.target) && e.target !== button) {
      picker.style.display = 'none';
    }
  });
}
