rm -f $1.aux $1.out $1.toc $1.ind $1.ilg $1.idx
xelatex -interaction=nonstopmode $1.tex
makeindex -o $1.ind $1.idx
xelatex -interaction=nonstopmode $1.tex
xelatex -interaction=nonstopmode $1.tex
