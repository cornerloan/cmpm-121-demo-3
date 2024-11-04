import "./style.css";

const APP_NAME = "Temp name";
const app = document.querySelector<HTMLDivElement>("#app")!;
document.title = APP_NAME;

const button = document.createElement("button");
button.innerText = "temp text";
app.append(button);
button.addEventListener("click", function () {
  alert("you clicked the button!");
});
