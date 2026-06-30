
PDF Latex:

- Sí hay una tabla y aparece solo la primera fila al final de una página, entonces pasar esta a la próxima página.
- Sí aparece al final de una página algún texto que termina en ":", entonces mejor moverlo para la próxima página o sí aparece algún header (h1, h2, h3, h4, h5).
- Hay tablas en que aparecen superpuestos los textos, quizás lo mejor es intentar que el contenido (ancho de las columnas) esté acorde al ancho de las columnas. 

Solo En PDF generado con pandoc (ver cómo se hace con @make):

- Cambiar el font para usar el mismo font que se usa en los pdfs generados con latex, parece que se hizo con los textos normales pero veo que los textos de los headers y bold no se muestran con el mismo font. 
- Se puede generar una primera parte de contenido semejante a la que se genera con latex, ahora no se está mostrando el Content (contenido)

Testear: 
    Adicionalmente en este html generado con make:
    - Agrega la posibilidad de evaluación como ya está implementado con los checkbox para sí aparece alguna texto como este: 
    Akzeptable Antworten: phrase1, phrase2, phrase3,...
    Respuestas aceptables: phrase1, phrase2, phrase3,...
    Acceptable answers: phrase1, phrase2, phrase3,...
    Que se ponga un <Input> y que permita que se teclee algo, y sí al pulsar en el botón de "Check answers" que se compare "no casesensitive" y eliminando los espacios tecleados, el texto introducido con alguna de las phrase definidas (claro que en cada una de las phrase debe de convertirse quizás a lowercas y eliminar los espacios, como en el texto introducido)
    - Agregar un tipo conf, es decir: ```conf que resalte este tipo de información. 


- Programar que el contenido esté por debajo del telón en elasticSearch y que se permita así hacer búsquedas avanzadas en el texto. 

    - Deseo que se genere un archivo de nombre links.md donde aparecen todos los links del markdown de entrada a procesar como un resumen de links y que este apartado aparezca al final del todo del markdown a procesar para generar el html. Ten en cuenta en los links que deben de aparecer en el mismo orden en que aparecen en el md original y separados por apartados de los h1 del md original pero en este caso como un h2 cada apartado, el h1 debe de llamarse Links.

- En el editor de código hay un botón que se llama "Ventana" y debe de llamarse "Window". Sí en el editor hay un código de tipo json o xml, deseo que se brinde esta opción de window para que se abra en una nueva ventana con el respectivo tipo de contenido json o xml y que el navegador lo reconozca. En el caso de typescript, que permita usar un transpilador de ts a js integrado en el editor y que ponga una opción de transpilar (en inglés) y sí se pulsa esta opción, que el resultado de transpilar se muestre en el editor de código y que aparezca arriba la opción javascript 

-----
- Me gustaría que los videos de youtube se inserten en el código html (make html) como video de Youtube embebido, y que se mantenga el link para el caso de epub y pdf pandoc, que se pueda acceder a este en estos documentos.
- Líneas con este texto "    Zum Umdrehen klicken", deseo que se borren
- Líneas con este patrón: "#####(.*)\n\n##### Zum Umdrehen klicken\n\n#####()" deseo que se conviertan en $1: $2 (sustituyendo aquí la expresión regular correspondiente)
- Sí hay código que no está entre quotes (```) o (`) deseo que se borre este patrón completo: {.*}
- Todo contenido que aparezca así: "#### Contenido", deseo que se convierta en: _Contenido_
- Este patrón: "    ## Contenido", quiero que se convierta  en: ***Contenido***
- Deseo que se borre todo el contenido que empieza en una línea con este contenido inicial: "##### slide:" y termina en la primera línea que aparece a continuación muchas líneas después y que tiene la frase: "data-savepage-src=", todo ese contenido debe de borrarse y sustituirse por: "▶ Slide", a no ser que aparezca una línea que empiece con "##### Transkript", en este caso, se borraría todo hasta esta línea.
- Sí aparece, después de la condición anterior alguna línea una vez que tenga en algún lugar la frase: "data-savepage-sameorigin=", debe de eliminarse completamente. 
----
- Sí aparece el patrón en alguna línea "\n\d+\s+\n" o "\n\d+\n", deseo que esas líneas se borren. 
- Hay una línea con este texto: {rel="\"noopener" noreferrer="" nofollow&quot;="" target="\"_blank\""} en una parte de la línea y no debe de aparecer, pues se dijo antes que el patrón {.*} debe de eliminarse sí no está entre ` o ```
- Sí aparece en alguna línea el texto "\nContenido](" en que falta el primer colchete que abre "[", deseo que se corrija por "\n[Contenido]("
- Sí aparece alguna línea con este patrón "\n\-\n" o "\n\-\s+\n", deseo que se borre
- Pueden haber enlaces como este que al final no se renderizan bien: [Zum E-Learning](%22https://community.elo.com/community/plugin/de.elo.ix.plugin.proxy/wf/apps/app/sol.learning.apps.Courses/?lang=de&#/course/(85B02616-F218-5CCF-8C58-D1B07AE3C875)%22), cuando debe de corregirse así: [Zum E-Learning](https://community.elo.com/community/plugin/de.elo.ix.plugin.proxy/wf/apps/app/sol.learning.apps.Courses/?lang=de&#/course/(85B02616-F218-5CCF-8C58-D1B07AE3C875)), es decir, eliminarse los espacios antes y después (trim) dentro de la URL del enlace y también se debería de hacer lo mismo en el nombre del enlace, a su vez, en la URL del enlace deben de escaparse caracteres como "(" y ")" creo.
-  Todo lo que aparezca con este patrón: "\n#### (.*)", deseo que se sustituya por "\n***$1***"
- Patrones como este deben de borrarse la línea: "\-\s+\d+\n", donde encajan líneas como esta: "-   1"

-----
- En el elo_technical_basics/05.md hay un video de youtube: ##### [▶ YouTube Video](https://www.youtube.com/watch?v=TV7SeO2X0pM), pero este no se está renderizando bien en el html pues aparece el error 153, Fehler bei der Konfiguration des Videoplayers. 

- Ver la parte de los quiz
- Sí aparece algún video físico en la carpeta html/videos, entonces deseo que se ponga en el html generado el video incustrado (<video... >) junto con el enlace. 
--------------
- Sí hay algo como esto en el texto: ")###" deseo que se convierta en esto: ")\n\n###"
- Todas las líneas de más de 2 líneas vacías o en blanco (\n\n\n+) deseo que se conviertan en dos líneas en blanco (\n\n)
- todas las líneas como esta "\n##### Modul Vorteile" deseo que se convietan en: "\nModul Vorteile" o esta "\n##### [**ELO Backup Server**]" deseo que se convierta en "***ELO Backup Server***", es decir, en la conversión, que se eliminen los asteriscos existentes (*) también. Encuentra el patrón pues simplemente deseo que el texto que viene después del #### se convierta se muestre en itálica. 
- Líneas como esta "\n💡Weitere Informationen zu den einzelnen Modulen erhalten Sie im ](https://supportweb.elo.com/de-de/)", deseo que se conviertan en: "[💡Weitere Informationen zu den einzelnen Modulen erhalten Sie im](https://supportweb.elo.com/de-de/)", encuentra el patrón genérico pues falta al principio el caracter "[" en la línea original
- Sí aparece alguna línea así: "(\*+)([A-z]+) (\*+)([A-z])", deseo que se corrija así: "$1$2$3 $4" por ejemplo:  "**Schnellzugriffe **und" debe de correjirse como: "**Schnellzugriffe** und"
- Sí aparece alguna línea así: "([A-z])(\*+) ([A-z ]+)(\*+)", deseo que se corrija así: "$1 $2$3$4", sí no hay más asteriscos (*) en otras partes de la línea, por ejemplo: "beliebige** vorgangsbezogene Drittapplikationen** integrieren" debe de correjirse como: "beliebige **vorgangsbezogene Drittapplikationen** integrieren"
- Líneas como esta: "##### ]" deben de eliminarse
-  Reemplaza esto `![\"\"]` por esto `![]` quitando los `
- Reemplaza esto: "\.\\\n" por esto "\.\n"
- Reemplaza todos los doble espacios "  " por un espacio: " "
- Sí aparece alguna línea como esta: "https://&lt;ELO Server mit installierter ELOac&gt;:&lt;Port&gt;/ix-&lt;Ziel-Repository&gt;/plugin/auth2/sign-in", que contiene unos caracteres como estos entre comillas: "&lt;", deseo que se convierta toda la línea en un enlace donde el texto y el enlace sean iguales. 
- Este es un ejemplo del código html generado con el video: 
<h5><a class="i_ident" id="i-Q/bE0wc0ql" href="#i-Q/bE0wc0ql" tabindex="-1" role="presentation"></a><div class="yt-embed"><iframe src="https://www.youtube.com/embed/TV7SeO2X0pM" width="560" height="315" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div><!--▶ YouTube Video--></h5>
Pero aparece el error: Video auf YouTube ansehen
Fehler 153
Fehler bei der Konfiguration des Videoplayers, 
Sin embargo el código que brinda youtube para mostralo embebido es este: 
<iframe width="560" height="315" src="https://www.youtube.com/embed/TV7SeO2X0pM" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>, puedes corregirlo?

<!--
Source - https://stackoverflow.com/a/79810109
Posted by Bart
Retrieved 2026-02-27, License - CC BY-SA 4.0
-->

<iframe src="https://www.youtube-nocookie.com/embed/TV7SeO2X0pM" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

----
Deseo que sí aparece esto: ")### " que se reemplace por esto ")\n\n### "

Buscar * y # en el html



(\[A-z])(\*+) [A-z]

eine** strukturierte Ablage**,
eine **strukturierte Ablage**,


Sí no hay antes o después ningún asterisco (*) o punto (.) antes de los primeros asteriscos ni después de los últimos, entonces sí está este patrón:

"([A-z]+)(\*+) ([A-z ]+)(\*+)" >  "$1 $2$3$4", ejemplo "beliebige** vorgangsbezogene Drittapplikationen** integrieren." quedaría así:
"beliebige **vorgangsbezogene Drittapplikationen** integrieren." 


----
Agrega a los patrones de limpieza en @_mdfromhtml/cleanup.json, agregar  los siguientes patrones de reemplazo:

- "![](%22%22)" por ""
