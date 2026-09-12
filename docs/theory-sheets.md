WHAT I CAN READ FROM THE SHEETS (image 2 is the legible one):

Colour legend, top right:  F C G D A E B  -> circle of fifths order.
Gaussian integers (a+bi) map to chords:

    0        -> F(#11)maj13 / F
    0+0i     -> F(#11)maj13 / A
    6+6i     -> F#maj13 / C#
   -6-6i     -> Gbmaj13 / Db      <- same pitches as +6, opposite spelling
    3+3i     -> Amaj13 / B
    1+i      -> Am13 / B
   -3-3i     -> Fm13 / D
   -4-4i     -> F(b13)m11 / Db

Everything sits on the diagonal n+ni, matching image 1's
    L = { n+ni : n in (Z \ 6Z) U {0} }

Image 1 defines operators C_{u,v}, N_+, N_-, and inverses, over mod-6
arithmetic, with p(0)=2*floor(0/6) and i(0)=abs(sgn 0)-sgn(0 mod 6).
Image 2 shows they form a group: N_+(N_+^-1(T)) = N_-^-1(N_-(T)) = T,
and iterating gives orbits, e.g. N_+^3({3+3i}) = N_-^-3({3+3i}).

WHAT I DID NOT DECODE: the exact root-from-n rule. n=0->F, n=3->A,
n=6->F# is neither semitones nor fifths, so p() and i() are doing
something I could not pin down from two photos. C_pol / C_tor
(polar / toroidal?) I could not reconstruct either.

WHAT IS ACTUALLY USABLE, AND IS NOT SPECULATIVE:
1. Every chord is a 13th chord. No triads anywhere.
2. Every chord is a SLASH chord - the bass is not the root, and is
   often a step or a third away (Amaj13/B, Fm13/D, Fmaj13/A).
   This is the single most valuable idea here: a bass note that does
   not agree with the chord is exactly what makes BOTW and Eno float.
3. Harmony as transformation orbits rather than scale degrees:
   pick a chord, apply a small move, repeat. Non-functional motion.
