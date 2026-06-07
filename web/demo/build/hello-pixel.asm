; hello-pixel.asm
;
; Mini ASM2Web demo: zet een palette-entry op rood en plot een pixel.
; Bewijst end-to-end: tokenize -> parse -> IR -> WASM -> runtime -> canvas.
;
; Geen RNG, geen loops, geen jumps -> straight-line WASM-codegen.

code SEGMENT
  ASSUME cs:code

main PROC NEAR
  ; --- palette entry #1 = (63, 0, 0)  (rood) ---
  mov al, 1
  out 3C8h, al            ; index register

  mov al, 63
  out 3C9h, al            ; R

  mov al, 0
  out 3C9h, al            ; G

  mov al, 0
  out 3C9h, al            ; B

  ; --- palette entry #2 = (0, 63, 0)  (groen) ---
  mov al, 2
  out 3C8h, al

  mov al, 0
  out 3C9h, al
  mov al, 63
  out 3C9h, al
  mov al, 0
  out 3C9h, al

  ; --- pixel op (10, 10) = framebuffer @ A0000h + 10*320 + 10 ---
  ; In TASM zou je es:[bx] gebruiken met es=A000h. Onze runtime mapt het
  ; VGA mode-13h frame-buffer flat in linear memory op offset 0A0000h, dus
  ; we kunnen rechtstreeks naar dat absolute offset schrijven.
  mov al, 1               ; palette index 1 (rood)
  mov [0A0000h + 10*320 + 10], al

  ; --- pixel op (20, 20) ---
  mov al, 2               ; palette index 2 (groen)
  mov [0A0000h + 20*320 + 20], al

  ; --- horizontale lijn pixel (50..60, 100) in groen ---
  mov al, 2
  mov [0A0000h + 100*320 + 50], al
  mov [0A0000h + 100*320 + 51], al
  mov [0A0000h + 100*320 + 52], al
  mov [0A0000h + 100*320 + 53], al
  mov [0A0000h + 100*320 + 54], al
  mov [0A0000h + 100*320 + 55], al
  mov [0A0000h + 100*320 + 56], al
  mov [0A0000h + 100*320 + 57], al
  mov [0A0000h + 100*320 + 58], al
  mov [0A0000h + 100*320 + 59], al

  ret
main ENDP

code ENDS
END main
