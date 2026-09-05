const lichessInput = document.getElementById("lichessName");
const chesscomInput = document.getElementById("chesscomName");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

chrome.storage.sync.get(["myUsernameLichess", "myUsernameChesscom"], (data) => {
  lichessInput.value = data.myUsernameLichess || "";
  chesscomInput.value = data.myUsernameChesscom || "";
});

saveBtn.addEventListener("click", () => {
  chrome.storage.sync.set(
    {
      myUsernameLichess: lichessInput.value.trim(),
      myUsernameChesscom: chesscomInput.value.trim(),
    },
    () => {
      status.textContent = "تم الحفظ ✓";
      setTimeout(() => (status.textContent = ""), 1500);
    }
  );
});
