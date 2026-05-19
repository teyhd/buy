function snackBAR(message) {
    var x = document.getElementById("snackbar");
  
    x.textContent = message;
  
    x.className = "show";
  
    setTimeout(function(){ x.className = x.className.replace("show", ""); }, 3000);
}
