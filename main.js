

document.addEventListener("DOMContentLoaded", function() {
  const smartBackBtn = document.getElementById('smartBackBtn');
  
  // Only run the logic if the button actually exists on this page
  if (smartBackBtn) {
    smartBackBtn.addEventListener('click', function(event) {
      event.preventDefault(); 
      
      if (document.referrer && document.referrer.includes(window.location.host)) {
        history.back(); 
      } else {
        window.location.href = this.getAttribute('href'); 
      }
    });
  }
});
