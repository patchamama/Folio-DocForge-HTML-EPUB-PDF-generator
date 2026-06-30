[← Herzlich willkommen](01_Einfuehrung.md) · [↑ Contents](content.md)

---

[🌐 View original web content](../Web/ejemplos.html)

---


# Manual de Formato

[](#p-AvmSyJhmRD)Este capítulo recorre todas las construcciones sintácticas disponibles en el sistema. Cada sección muestra primero la sintaxis fuente y luego el resultado renderizado.

## [](#h-wObFWKUzth)1. Bloques de Código

[](#p-E5VMBVLpPn)Los bloques de código se delimitan con tres backticks y un identificador de lenguaje estándar. Para mostrar el código fuente sin highlight se deja el bloque sin lenguaje.

### [](#i-xpaKXUrIhk)1.1 JavaScript

[](#p-09qIs8E+eq)Sintaxis:

```` 
```js
function suma(a, b) {
  return a + b;
}
console.log(suma(2, 3));
```
````

[](#p-x1idvykMiU)Resultado:

```
function suma(a, b) {
  return a + b;
}
console.log(suma(2, 3));
```

### [](#i-bRmh+epHoc)1.2 Python

[](#p-09qIs8E+eq_1)Sintaxis:

```` 
```py
def suma(a, b):
    return a + b

print(suma(2, 3))
```
````

[](#p-x1idvykMiU_1)Resultado:

```
def suma(a, b):
    return a + b

print(suma(2, 3))
```

### [](#i-9VeM8ZNsWo)1.3 HTML

[](#p-09qIs8E+eq_2)Sintaxis:

```` 
```html
  <h1>Hola mundo</h1>
  <p>Este es un párrafo.</p>
```
````

[](#p-x1idvykMiU_2)Resultado:

```
  <h1>Hola mundo</h1>
  <p>Este es un párrafo.</p>
```

### [](#i-0LVjoCCmLc)1.4 CSS

```` 
```css
.contenedor {
  max-width: 800px;
  margin: 0 auto;
  padding: 1em 2em;
}
```
````

[](#p-x1idvykMiU_3)Resultado:

```
.contenedor {
  max-width: 800px;
  margin: 0 auto;
  padding: 1em 2em;
}
```

### [](#i-UYZk5W98XW)1.5 TypeScript

```` 
```ts
interface Punto {
  x: number;
  y: number;
}

function distancia(a: Punto, b: Punto): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
```
````

[](#p-x1idvykMiU_4)Resultado:

```
interface Punto {
  x: number;
  y: number;
}

function distancia(a: Punto, b: Punto): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
```

### [](#i-x++UG2GmkJ)1.6 JSON

```` 
```json

}
```
````

[](#p-x1idvykMiU_5)Resultado:

```

}
```

### [](#i-JH4xPmKw0z)1.7 Sin highlight

[](#p-jPZMjkhLOQ)Cuando no se especifica lenguaje el bloque se muestra tal cual, sin colorear. Esto también permite mostrar directivas `}` como texto literal:

```` 
```
}}
```
````

[](#p-x1idvykMiU_6)Resultado:

```
}}
```

### [](#i-VLlPyjLhhw)1.8 PHP

[](#p-09qIs8E+eq_3)Sintaxis:

```` 
```php
<?php
function suma(int $a, int $b): int {
    return $a + $b;
}
echo suma(2, 3);
```
````

[](#p-x1idvykMiU_7)Resultado:

```
<?php
function suma(int $a, int $b): int {
    return $a + $b;
}
echo suma(2, 3);
```

### [](#i-fSzcAK5uqq)1.9 XML

[](#p-09qIs8E+eq_4)Sintaxis:

```` 
```xml
<?xml version="1.0" encoding="UTF-8"?>
<libro>
  <capítulo numero="1">
    <título>Introducción</título>
    <párrafo>Contenido del capítulo.</párrafo>
  </capítulo>
</libro>
```
````

[](#p-x1idvykMiU_8)Resultado:

```
<?xml version="1.0" encoding="UTF-8"?>
<libro>
  <capítulo numero="1">
    <título>Introducción</título>
    <párrafo>Contenido del capítulo.</párrafo>
  </capítulo>
</libro>
```

### [](#i-Sb0KDrRo+h)1.10 Java

[](#p-09qIs8E+eq_5)Sintaxis:

```` 
```java
public class Suma {
    public static int suma(int a, int b) {
        return a + b;
    }

    public static void main(String args) {
        System.out.println(suma(2, 3));
    }
}
```
````

[](#p-x1idvykMiU_9)Resultado:

```
public class Suma {
    public static int suma(int a, int b) {
        return a + b;
    }

    public static void main(String args) {
        System.out.println(suma(2, 3));
    }
}
```

### [](#i-Xl+qTCcu/9)1.11 Go

[](#p-09qIs8E+eq_6)Sintaxis:

```` 
```go
package main

import "fmt"

func suma(a, b int) int {

return a + b

}

func main() {
    fmt.Println(suma(2, 3))
}
```
````

[](#p-x1idvykMiU_10)Resultado:

```
package main

import "fmt"

func suma(a, b int) int {

return a + b

}

func main() {
    fmt.Println(suma(2, 3))
}
```

### [](#i-1OTaqAGKpV)1.12 C

[](#p-09qIs8E+eq_7)Sintaxis:

```` 
```c
#include <stdio.h>

int suma(int a, int b) {

return a + b;

}

int main() {
    printf("Resultado: %d\n", suma(2, 3));
    return 0;
}
```
````

[](#p-x1idvykMiU_11)Resultado:

```
#include <stdio.h>

int suma(int a, int b) {

return a + b;

}

int main() {
    printf("Resultado: %d\n", suma(2, 3));
    return 0;
}
```

### [](#i-QnE1BeLT5U)1.13 C++

[](#p-09qIs8E+eq_8)Sintaxis:

```` 
```cpp
#include <iostream>
using namespace std;

int suma(int a, int b) {

return a + b;

}

int main() {
    cout << "Resultado: " << suma(2, 3) << endl;
    return 0;
}
```
````

[](#p-x1idvykMiU_12)Resultado:

```
#include <iostream>
using namespace std;

int suma(int a, int b) {

return a + b;

}

int main() {
    cout << "Resultado: " << suma(2, 3) << endl;
    return 0;
}
```

### [](#i-dFgwMaOXL4)1.14 Pascal

[](#p-09qIs8E+eq_9)Sintaxis:

```` 
```pascal
program Suma;

function Suma(a, b: integer): integer;

begin

Suma := a + b;

end;

begin

WriteLn('Resultado: ', Suma(2, 3));

end.
```
````

[](#p-x1idvykMiU_13)Resultado:

```
program Suma;

function Suma(a, b: integer): integer;

begin

Suma := a + b;

end;

begin

WriteLn('Resultado: ', Suma(2, 3));

end.
```

## [](#h-VOAE+29MTB)2. Imágenes

[](#p-TnLMqJmQvT)Las imágenes se insertan con la sintaxis estándar ``. Para opciones adicionales (marco, ancho, estilo capítulo) se coloca un comentario `<!-- figure-options:  -->` inmediatamente antes de la imagen.

### [](#i-QF8/zY+gNb)2.1 Imagen Normal

[](#p-09qIs8E+eq_10)Sintaxis:

```
![Un gato sentado](./images/ejemplos/002.png)
```

[](#p-+1SJ8HhkQP)El resultado se ve así:

![Un gato sentado](./images/ejemplos/002.png)

### [](#i-PzFGBVa79G)2.2 Imagen de Capítulo

[](#p-mg0OLjqk4a)La opción `chapter: true` centra la imagen y la presenta en estilo portada de capítulo:

```
<!-- figure-options:  -->

![Imagen de capítulo](./images/ejemplos/003.jpg)
```

[](#p-x1idvykMiU_14)Resultado:

![Imagen de capítulo](./images/ejemplos/003.jpg)

### [](#i-DXhaTzheKg)2.3 Imagen Circular (framed)

[](#p-k9/UqkB0hL)La opción `chapter: "framed"` produce una imagen con marco circular:

```
<!-- figure-options:  -->

![Un avestruz](./images/ejemplos/004.png)
```

[](#p-x1idvykMiU_15)Resultado:

![Un avestruz](./images/ejemplos/004.png)

### [](#i-2DvDhPnDLC)2.4 Imagen Square-Framed

[](#p-NaRn7PNRaL)Para un marco con esquinas redondeadas se usa `chapter: "square-framed"`:

```
<!-- figure-options:  -->

![Un robot inactivo](./images/ejemplos/004.png)
```

[](#p-x1idvykMiU_16)Resultado:

![Un robot inactivo](./images/ejemplos/004.png)

### [](#i-KYFjp6l1IL)2.5 Imagen con Ancho Personalizado

[](#p-pxQ+9sie0r)La opción `width` permite controlar el ancho de la imagen (tiene efecto especialmente en PDF):

```
<!-- figure-options:  -->

![Lista enlazada](./images/ejemplos/005.svg)
```

[](#p-x1idvykMiU_17)Resultado:

![Lista enlazada](./images/ejemplos/005.svg)

[](#p-arSKbX7qUx)Otro ejemplo con un ancho diferente:

![Árbol HTML](./images/ejemplos/006.svg)

## [](#h-/QSXuURbMe)3. Tablas

[](#p-JG/AjScrwM)Las tablas se escriben con la sintaxis de pipe estándar de GitHub Flavored Markdown. La fila separadora `|---|` es requerida por GFM y el script la elimina automáticamente al convertir:

```
| Formato | Extensión | Generador |
| ---------------- | ----------- | -------------------------- |
| HTML interactivo | .html | render_html.mjs |
| EPUB | .xhtml | render_html.mjs --epub |
| PDF | .tex → .pdf | render_latex.mjs + xelatex |
```

[](#p-x1idvykMiU_18)Resultado:

| Formato Extensión | Generador |
| --- | --- |
| HTML interactivo | .html | render_html.mjs |
| EPUB | .xhtml | render_html.mjs \--epub |
| PDF | .tex → .pdf | render_latex.mjs + xelatex |

[](#p-GXl4i6+TPG)Una tabla más extensa comparando tipos de imágenes:

| Tipo Sintaxis clave | Imagen de ejemplo |
| --- | --- |
| Normal url, alt | cat.png |
| Capítulo | chapter: true chapter_picture_00.jpg |
| Circular | chapter: "framed" ostrich.png |
| Square-framed | chapter: "square-framed" | robot_idle.png |
| Con ancho | width: "Xcm" linked-list.svg |
| Adicional | --- canvas_pie_chart.png |

## [](#h-mNi4y81iGb)4. Admoniciones

[](#p-WUF9wBdjhm)Las admoniciones se escriben con la sintaxis de alertas de GitHub (`> [!TIPO]`). El script las convierte a `<div class="admonition">` del proyecto.

### [](#i-Da8YM+tC1O)4.1 Note

```
> [!NOTE]
> Este es un aviso informativo general.
```

[](#p-x1idvykMiU_19)Resultado:

**Note:** Este es un aviso informativo general.

### [](#i-+Yjzot7ZmY)4.2 Warning

```
> [!WARNING]
> Presta atención a este punto antes de continuar.
```

[](#p-x1idvykMiU_20)Resultado:

**Warning:** Presta atención a este punto antes de continuar.

### [](#i-sPKY8qaKcQ)4.3 Tip

```
> [!TIP]
> Este consejo puede ahorrarte tiempo en la práctica.
```

[](#p-x1idvykMiU_21)Resultado:

**Tip:** Este consejo puede ahorrarte tiempo en la práctica.

### [](#i-QifdNP2shY)4.4 Important

```
> [!IMPORTANT]
> Este punto es clave para que el sistema funcione correctamente.
```

[](#p-x1idvykMiU_22)Resultado:

**Important:** Este punto es clave para que el sistema funcione correctamente.

### [](#i-N9Bt7TW4Z9)4.5 Caution

```
> [!CAUTION]
> Ignorar esta etapa puede provocar la pérdida de datos.
```

[](#p-x1idvykMiU_23)Resultado:

**Caution:** Ignorar esta etapa puede provocar la pérdida de datos.

## [](#h-wyxdI7I72b)5. Citas y Epígrafos

[](#p-hQYnevZ1p9)Las citas se escriben como blockquote estándar precedido por un comentario `<!-- quote:  -->` que porta los metadatos (autor, título, opciones).

### [](#i-xKbIoviiKb)5.1 Cita con atribución

[](#p-+a7CWXCokW)Una cita con autor y título de obra:

```
<!-- quote:  -->

> La lengua corrupta corrompía el pensamiento.
```

[](#p-x1idvykMiU_24)Resultado:

> [](#p-vhSm/DU5Gl)La lengua corrupta corrompía el pensamiento.
>
> George Orwell, 1984

### [](#i-p4h2ujDtCw)5.2 Epigrafo de capítulo

[](#p-ds2IPiJCHI)Un epigrafo aparece antes del título en la versión PDF. Se añade `chapter: true` en el comentario:

```
<!-- quote:  -->

> We may only have a short time with each other,
> but it will take eternity to forget you.
```

[](#p-x1idvykMiU_25)Resultado:

> [](#p-fXOq+hPwrE)We may only have a short time with each other, but it will take eternity to forget you.
>
> Alan Turing, Computing Machinery and Intelligence

## [](#h-lhkoZvviBk)6. Hints (Ejercicios)

[](#p-BAFhP+KlLe)Los bloques de pista se renderizas como desplegables en HTML interactivo y se eliminan en PDF. Se marcan con comentarios `<!-- hint -->` y `<!-- /hint -->`:

```
<!-- hint -->

La clave está en usar un bucle `for...of` en lugar de un índice numérico.

<!-- /hint -->
```

[](#p-x1idvykMiU_26)Resultado:

Display hints\...

[](#p-iNPwn/vha3)La clave está en usar un bucle `for...of` en lugar de un índice numérico.

## [](#h-kdV1rYbEXu)7. Términos de Índice

[](#p-MiX6FrKEn8)Los términos de índice solo tienen efecto en la compilación PDF. En HTML y EPUB se ignoran.

### [](#i-7WUk6A8xs5)7.1 Término inline

[](#p-mMqOq+djUq)Un término inline se marca con comentarios `((` y `))` alrededor de la palabra:

```
El concepto de <!-- index-inline -->recursión<!-- /index-inline --> es fundamental en programación.
```

[](#p-x1idvykMiU_27)Resultado:

[](#p-tGonzGuLz+)El concepto de recursión es fundamental en programación.

### [](#i-fVy+Te5ptE)7.2 Directivas de bloque

[](#p-RkIsUTyNgg)Se pueden añadir entradas al índice sin texto visible mediante comentarios:

```
<!-- index: "estructura de datos" -->
<!-- index: ["árbol", "árbol binario"] -->
<!-- indexsee: "hash", "tabla hash" -->
```

[](#p-aGqkvAOXzt)Estas directivas no producen texto visible pero generan entradas en el índice del PDF.

## [](#h-l5D2GPp7U/)8. Bloques Condicionales

[](#p-OoDgTwrVfz)Los bloques condicionales permiten mostrar contenido solo en determinados formatos de salida. Se delimitan con `<!-- if: condición -->` y `<!-- endif -->`.

### [](#i-PbO767iqhD)8.1 Solo en libro (EPUB/PDF)

```
<!-- if: book -->

Este párrafo solo aparece en la versión EPUB y en el PDF.

<!-- endif -->
```

[](#p-x1idvykMiU_28)Resultado:

### [](#i-6F6DdDx+7p)8.2 Solo en HTML interactivo

```
<!-- if: interactive -->

Este párrafo solo aparece cuando se compila con `make html`.

<!-- endif -->
```

[](#p-x1idvykMiU_29)Resultado:

[](#p-Wlylasev5D)Este párrafo solo aparece cuando se compila con `make html`.

### [](#i-M6o8yxF+Zk)8.3 Solo en PDF (tex)

```
<!-- if: tex -->

Este párrafo solo aparece en la compilación LaTeX/PDF.

<!-- endif -->
```

[](#p-x1idvykMiU_30)Resultado:

## [](#h-omORhxNohk)9. Nombres de Teclas

[](#p-zIXWG4ikdc)Los nombres de teclas se escriben con la etiqueta HTML `<kbd>`, que GitHub renderiza con estilo de tecla física. El script los convierte a `texto`.

```
Guarda el archivo con <kbd>Ctrl+S</kbd> o abre el menú con <kbd>Alt+F</kbd>.
```

[](#p-x1idvykMiU_31)Resultado:

[](#p-wAwSkFlywX)Guarda el archivo con Ctrl+S o abre el menú con Alt+F.

[](#p-XWKdo7EW7v)Otros ejemplos: Enter, Escape, Tab.

## [](#h-y58YvG5ba6)10. Sub y Superíndices

[](#p-Zx+u/qcJ67)Se usan las etiquetas HTML `<sub>` y `<sup>` que GitHub renderiza directamente. El script las convierte a `~…~` y `^…^`.

### [](#i-WMNVGFE67V)10.1 Subíndice

```
H<sub>2</sub>O es la fórmula del agua.
```

[](#p-x1idvykMiU_32)Resultado:

[](#p-ry6M20GdQP)H~2~O es la fórmula del agua.

### [](#i-PBsVZfAgu6)10.2 Superíndice

```
La complejidad es O(n<sup>2</sup>) en el peor caso.
```

[](#p-x1idvykMiU_33)Resultado:

[](#p-PU1WswE6Ft)La complejidad es O(n^2^) en el peor caso.

### [](#i-uJqhyoMMZL)10.3 Combinado

[](#p-Nl9nanxXI8)Se puede combinar sub y superíndice en la misma expresión:

```
La fórmula general es x<sub>i</sub><sup>2</sup> + y<sub>j</sub><sup>3</sup>.
```

[](#p-x1idvykMiU_34)Resultado:

[](#p-iKdBQMfl+G)La fórmula general es x~i~^2^ + y~j~^3^.

## [](#h-JnL8yM/xcq)11. enlaces Internos

[](#p-4e1qpaG85T)Los enlaces internos se escriben con la sintaxis estándar de Markdown. Si tienes un archivo `01_valores.md`, puedes enlazarlo así:

```
[el capítulo de valores](valores)
```

[](#p-zJ+jtGvv/F)El sistema busca el archivo que termine en `_valores.md` y genera el enlace correcto (`.html` en HTML, `.xhtml` en EPUB).

## [](#h-iEM+A8BfLX)12. Bloques Ocultos e IDs

### [](#i-hKoGay0oEX)12.1 Bloques de código ocultos

[](#p-ZJYmLRHf2i)La opción `hidden: true` oculta un bloque de código en el output. Útil para setup previo a un ejercicio. Se indica con un comentario `<!-- code-options:  -->` antes del bloque:

```` 
<!-- code-options:  -->

```js
// Este bloque no se ve al renderizar
let estado = ;
```
````

### [](#i-ECUfQjAvKS)12.2 IDs manuales

[](#p-P18icI1apV)La directiva de ID se indica con un comentario `<!-- id: "identificador" -->` inmediatamente antes del heading:

```
<!-- id: "seccion-importante" -->

## Esta sección tiene un id custom

```

[](#p-1cAGVycZIy)Esto permite crear enlaces precisos hacia esa sección desde otro lugar:

```
[ir a la sección importante](#seccion-importante)
```

## [](#h-ILP36aGOGM)13. Elementos Estándar de Markdown

[](#p-r+MxQPQHvV)Esta sección cubre los elementos de formato básicos de GitHub Flavored Markdown. El script `convert_gfm.mjs` los pasa sin modificar al renderizador `markdown-it`, que los convierte a HTML/LaTeX nativamente. El objetivo es verificar que todos estos formatos se conservan correctamente a través de la cadena de conversión.

### [](#i-VP92ctdth0)13.1 Negrita

[](#p-yQASvi0IWo)Se delimita con doble asterisco `**…**` o doble guión bajo `__…__`:

```
Este texto tiene palabras en **negrita** y otras en **también negrita**.
```

[](#p-x1idvykMiU_35)Resultado:

[](#p-Wzq80lijC+)Este texto tiene palabras en **negrita** y otras en **también negrita**.

### [](#i-sNTzXCX1gR)13.2 Cursiva (itálica)

[](#p-yQASvi0IWo_1)Se delimita con un solo asterisco `*…*` o un solo guión bajo `_…_`:

```
Este texto tiene palabras en _cursiva_ y otras en _también cursiva_.
```

[](#p-x1idvykMiU_36)Resultado:

[](#p-BF3KkDAf2y)Este texto tiene palabras en *cursiva* y otras en *también cursiva*.

### [](#i-QOb7Q91sFy)13.3 Negrita y cursiva combinadas

[](#p-wpkSzyZPXe)Se combinan tres asteriscos `***…***`:

```
Este texto es **_negrita y cursiva al mismo tiempo_**.
```

[](#p-x1idvykMiU_37)Resultado:

[](#p-5DmLkLpgFx)Este texto es ***negrita y cursiva al mismo tiempo***.

### [](#i-T7CRewvfD+)13.4 Tachado (strikethrough)

[](#p-IqCetdgMkD)Se delimita con doble tilde `~~…~~` (extensión GFM):

```
Esta palabra está ~~tachada~~ en el texto.
```

[](#p-x1idvykMiU_38)Resultado:

[](#p-lFUgLiak6n)Esta palabra está ~~tachada~~ en el texto.

### [](#i-4YIlZxEt8Z)13.5 Listas no ordenadas

[](#p-Q4YHc+aalo)Se crean con `-`, `*` o `+` al inicio de cada línea:

```
- Elemento uno
- Elemento dos
- Elemento tres
```

[](#p-x1idvykMiU_39)Resultado:

- [](#p-cgfr1ObDvs)Elemento uno

- [](#p-9mfm/HcGD4)Elemento dos

- [](#p-0x3owvLa1b)Elemento tres

### [](#i-0m3az7QDBM)13.6 Listas ordenadas (numeradas)

[](#p-BLeMZGMxpW)Se crean con un número seguido de punto `N.`:

```
1. Primer paso
2. Segundo paso
3. Tercer paso
```

[](#p-x1idvykMiU_40)Resultado:

1. [](#p-1bI3RjCRTv)Primer paso

2. [](#p-WrUSqKtGPe)Segundo paso

3. [](#p-22Osp3EBb6)Tercer paso

### [](#i-5WNnZLyziH)13.7 Listas anidadas

[](#p-JlQywHCzpk)Se crean indentando los elementos hijos con 2-4 espacios. Se puede mezclar listas ordenadas y no ordenadas:

```
- Categoría A
  - Subcategoría A1
  - Subcategoría A2
- Categoría B
  1. Paso B1
  2. Paso B2
```

[](#p-x1idvykMiU_41)Resultado:

- [](#p-RjZJ6GPAMq)Categoría A

    - [](#p-IJS4V3PcE3)Subcategoría A1

    - [](#p-OJDWNQOjOG)Subcategoría A2

- [](#p-uW1XyAwWLR)Categoría B

    1. [](#p-/OyZxJYROs)Paso B1

    2. [](#p-T0ZTchjZJm)Paso B2

### [](#i-OgJtly8dz7)13.8 Blockquote estándar

[](#p-oC6Qmj/T8/)Un blockquote sencillo se crea con `>` al inicio de cada línea. Se diferencia de las admoniciones (sección 4) en que no tiene `[!TIPO]` y de las citas con atribución (sección 5) en que no tiene `<!-- quote -->`:

```
> Esta es una cita estándar sin atribución.
> Puede ocupar varias líneas consecutivas.
```

[](#p-x1idvykMiU_42)Resultado:

> [](#p-n+op53opAm)Esta es una cita estándar sin atribución. Puede ocupar varias líneas consecutivas.

### [](#i-0XRvoGeEOE)13.9 Regla horizontal

[](#p-pIzQXsslBP)Se crea con tres o más guiones `---`, asteriscos `***` o guiones bajos `___`. Debe estar separada por líneas en blanco para no interpretarse como subheading (setext):

```
Párrafo antes de la regla.

---

Párrafo después de la regla.
```

[](#p-x1idvykMiU_43)Resultado:

[](#p-iIq+ZHXbLR)Párrafo antes de la regla.

---

[](#p-w7nXULTZJ8)Párrafo después de la regla.

### [](#i-vVrFuAZn/I)13.10 Código inline con backticks

[](#p-TUnKaUR5DI)Se encierra entre un par de backticks `` `…` ``:

```
Para declarar una variable se usa `const` o `let` en JavaScript.
```

[](#p-x1idvykMiU_44)Resultado:

[](#p-x66A95e6pv)Para declarar una variable se usa `const` o `let` en JavaScript.

### [](#i-xddoambZsC)13.11 Bloque de código indentado

[](#p-extyisW6de)Cuatro espacios o un tab al inicio de cada línea producen un bloque de código sin highlight, equivalente a un bloque fenced sin identificador de lenguaje:

```
    function hola() {
        return "Hola mundo";
    }
```

[](#p-x1idvykMiU_45)Resultado:

``` snippet
function hola() {
    return "Hola mundo";
}
```

[](#p-2XlxAC3P6e)**Nota:** Una indentación menor de 4 espacios (1-3 espacios) no se conserva en el output renderizado: Markdown la colapsa y trata la línea como párrafo normal. Para márgenes visuales se recomienda usar blockquote (`>`) o un bloque de código.

### [](#i-rfzWZp8N9E)13.12 enlaces externos

[](#p-QfC5y9cTUk)Se crean con la sintaxis estándar `[texto visible](URL)`:

```
El proyecto se documenta en [GitHub](https://github.com).
```

[](#p-x1idvykMiU_46)Resultado:

[](#p-rkC3yO+DFV)El proyecto se documenta en [GitHub](https://github.com).

## [](#h-4ShDHtdoQx)14. Quiz --- Conceptos de JavaScript

[](#p-oJszNV4IrM)Cada pregunta es una lista de opciones con casillas de verificación. Marca las respuestas que consideras correctas y pulsa **Check answers** para comprobar.

[](#p-fTfBgEBGgo)Puedes crear un quiz usando como ejemplo este markdown:

```
¿Cuáles de los siguientes son tipos de datos primitivos en JavaScript?

- [x] `string`
- [x] `number`
- [ ] `array`
- [x] `boolean`
- [ ] `object`
- [x] `undefined`
```

### [](#i-uNNTMfo5GP)14.1 Tipos de datos

[](#p-O4cJ92/B8v)¿Cuáles de los siguientes son tipos de datos primitivos en JavaScript?

- [](#p-2jmj7l5rSw) `string`

- [](#p-2jmj7l5rSw_1) `number`

- [](#p-2jmj7l5rSw_2) `array`

- [](#p-2jmj7l5rSw_3) `boolean`

- [](#p-2jmj7l5rSw_4) `object`

- [](#p-2jmj7l5rSw_5) `undefined`

### [](#i-1Lqmi7bp7h)14.2 Declaración de variables

[](#p-XHg3puYflj)¿Qué palabras clave se utilizan para declarar variables en JavaScript moderno?

- [](#p-2jmj7l5rSw_6) `let`

- [](#p-2jmj7l5rSw_7) `const`

- [](#p-2jmj7l5rSw_8) `define`

- [](#p-2jmj7l5rSw_9) `dim`

- [](#p-2jmj7l5rSw_10) `var`

## [](#h-7AaNTM5fZi)15. Quiz --- Buenas prácticas de desarrollo

### [](#i-EYsYiWOD1t)15.1 Versionado

[](#p-RwxZXmRwwi)¿Qué herramientas o conceptos pertenecen al control de versiones?

- [](#p-2jmj7l5rSw_11) `git commit`

- [](#p-2jmj7l5rSw_12) `npm start`

- [](#p-2jmj7l5rSw_13) `branch`

- [](#p-2jmj7l5rSw_14) `merge`

- [](#p-2jmj7l5rSw_15) `transpile`

### [](#i-T5Tda/NzXD)15.2 Pruebas de código

[](#p-vMrlb1UV7W)¿Cuáles de las siguientes afirmaciones sobre las pruebas son correctas?

- [](#p-FEcYJqGUrY) Las pruebas unitarias verifican funciones individuales

- [](#p-u9z0VUQ9E1) Las pruebas reemplazan la revisión manual del código

- [](#p-DwZt5C4VgN) Es recomendable escribir pruebas antes del código (TDD)

- [](#p-i/Th2b3LbP) Los tests de integración verifican la interacción entre componentes

- [](#p-8Vp9AP9iJ3) Solo es necesario testear el código de producción

---

[← Herzlich willkommen](01_Einfuehrung.md) · [↑ Contents](content.md)
