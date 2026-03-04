async function loadSongs() {

    const response = await fetch("Database/track_data_final.csv");
    const data = await response.text();

    const rows = data.split("\n").slice(1);

    const list = document.getElementById("approvedList");

    list.innerHTML = "";

    rows.slice(0,20).forEach(row => {

        const cols = row.split(",");

        const title = cols[0];
        const artist = cols[1];

        if(title && artist){

            const li = document.createElement("li");
            li.textContent = artist + " - " + title;

            list.appendChild(li);

        }

    });

}

loadSongs();

setInterval(loadSongs,5000);