; seg-test.asm
;
; Synthetische test voor de x86 segment:offset memory-tracker.
; Bewijst dat `mov ax,0a000h / mov es,ax` als segment-base const-load wordt
; herkend en dat es:[di] correct resolveert naar linear 0A0000h+di.
;
; Geen self-modifying code, geen externe caller-setup -> volledig zelf-bevattend
; en dus een ZUIVERE proof voor de segment-folding-infrastructuur.

code SEGMENT
  ASSUME cs:code

main PROC NEAR
  ; --- es = A000h (VGA frame-buffer segment) ---
  mov ax, 0a000h
  mov es, ax

  ; --- pixel via es:[di] op (10,10) = 10*320+10 = 3210 ---
  mov di, 3210
  mov al, 15
  mov byte ptr es:[di], al     ; -> linear 0A0000h + 3210

  ; --- pixel via es:[di] op (20,20) = 20*320+20 = 6420 ---
  mov di, 6420
  mov al, 31
  mov byte ptr es:[di], al     ; -> linear 0A0000h + 6420

  ; --- ds = A000h ook, en schrijf via ds:[si] ---
  mov ax, 0a000h
  mov ds, ax
  mov si, 100
  mov al, 7
  mov byte ptr ds:[si], al     ; -> linear 0A0000h + 100

  ret
main ENDP

code ENDS
END main
