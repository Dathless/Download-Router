import '../style.css';

document
  .querySelector<HTMLButtonElement>('#options')!
  .addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
