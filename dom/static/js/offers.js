async function loadOffer() {
    let jsonResponse ={} 
    
    fetch("http://127.0.0.1:83/api/offers")
        .then(res => res.json())
        .then(data => {
            jsonResponse = JSON.stringify(data, null, 2); 
        })

    if (jsonResponse.haveOffers) {
        let message = document.createElement('div');
        message.src=jsonResponse.link;
        message.innerHTML=jsonResponse.message||"offer message";
        document.body.appendChild(message);
    }

    if (config.params && config.params.search) {
        await logQuery('/logger', config.params);
    }
}

window.addEventListener("load", loadOffer);