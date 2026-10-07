"""Measure rendered frames against independently decoded source samples.

Usage: python compare.py SOURCE.mp4 RENDER_DIRECTORY_OR_VIDEO REPORT_DIRECTORY [WIDTH] [--resume]
Requires numpy, opencv-python-headless, scikit-image and Pillow.
The whole-frame score, foreground score, and minimum frame are all retained.
"""
import sys, json, math
from pathlib import Path
import cv2
import numpy as np
from ssim import rgb_ssim
from PIL import Image, ImageDraw

source,render_dir,out=Path(sys.argv[1]),Path(sys.argv[2]),Path(sys.argv[3])
width=int(sys.argv[4]) if len(sys.argv)>4 else 720
height=width*3//4
out.mkdir(parents=True,exist_ok=True)
def identity(path):
    if path.is_file():
        s=path.stat();return [str(path.resolve()),s.st_size,s.st_mtime_ns]
    return [[p.name,p.stat().st_size,p.stat().st_mtime_ns] for p in sorted(path.glob('*.png'))]
signature={'source':identity(source),'render':identity(render_dir),'width':width,'metric':'skimage-RGB-SSIM-7x7-v1'}
progress=out/'progress.jsonl';manifest=out/'inputs.json';rows=[]
if '--resume' in sys.argv and progress.exists():
    if not manifest.exists() or json.loads(manifest.read_text())!=signature: raise RuntimeError('Cannot resume: comparison inputs changed.')
    rows=[json.loads(line) for line in progress.read_text().splitlines() if line.strip()]
    if [r['frame'] for r in rows]!=list(range(1,len(rows)+1)): raise RuntimeError('Incomplete comparison progress file.')
else:
    manifest.write_text(json.dumps(signature,indent=2));progress.write_text('')
progress_stream=progress.open('a',buffering=1)
video=cv2.VideoCapture(str(source))
render_video=cv2.VideoCapture(str(render_dir)) if render_dir.is_file() else None
if render_video is not None:
    render_fps=render_video.get(cv2.CAP_PROP_FPS)
    if abs(render_fps-24000/1001)>.001: raise RuntimeError('Video comparisons require native 24000/1001 cadence.')
if rows:
    video.set(cv2.CAP_PROP_POS_FRAMES,len(rows))
    if render_video is not None: render_video.set(cv2.CAP_PROP_POS_FRAMES,len(rows))
def replica_frame(index,seek=False):
    if render_video is None: return cv2.imread(str(render_dir/f'{index+1:04}.png'))
    if seek: render_video.set(cv2.CAP_PROP_POS_FRAMES,index)
    ok,image=render_video.read()
    return image if ok else None
for i in range(len(rows),489):
    ok,original=video.read()
    if not ok: raise RuntimeError(f'Source decode ended at frame {i+1}')
    original=cv2.resize(original,(width,height),interpolation=cv2.INTER_AREA)
    replica=replica_frame(i)
    if replica is None: raise RuntimeError(f'Missing recreated frame {i+1}')
    if replica.shape!=original.shape:
        if render_video is not None: replica=cv2.resize(replica,(width,height),interpolation=cv2.INTER_AREA)
        else: raise RuntimeError(f'Dimension mismatch at frame {i+1}')
    score,ssim_map=rgb_ssim(original,replica)
    gray=cv2.cvtColor(original,cv2.COLOR_BGR2GRAY).astype(np.float32)
    broad=cv2.GaussianBlur(gray,(0,0),max(3,width/60))
    saturation=original.max(axis=2).astype(float)-original.min(axis=2)
    edge=np.abs(cv2.Laplacian(gray,cv2.CV_32F))
    mask=((np.abs(gray-broad)>12)|(saturation>35)|(edge>22)).astype(np.uint8)
    mask=cv2.dilate(mask,np.ones((max(3,width//144),)*2,np.uint8))>0
    difference=original.astype(float)-replica.astype(float)
    mse=float(np.mean(difference**2));mae=float(np.mean(np.abs(difference)))
    foreground=float(ssim_map[mask].mean()) if mask.any() else None
    row={'frame':i+1,'seconds':i*1001/24000,'ssim':float(score),'foreground_ssim':foreground,'foreground_fraction':float(mask.mean()),'mae_8bit':mae,'psnr_db':10*math.log10(255**2/mse) if mse else 100}
    rows.append(row)
    progress_stream.write(json.dumps(row)+'\n')
    if i%24==0: print(f'{i+1}/489 SSIM {score:.5f}',flush=True)
video.release()
progress_stream.close()
scores=[r['ssim'] for r in rows]
fg=[r['foreground_ssim'] for r in rows if r['foreground_ssim'] is not None]
summary={'dimensions':[width,height],'frames':len(rows),'native_fps':'24000/1001','mean_ssim':float(np.mean(scores)),'min_ssim':float(min(scores)),'percentile_5_ssim':float(np.percentile(scores,5)),'mean_foreground_ssim':float(np.mean(fg)),'frames_at_least_099':sum(x>=.99 for x in scores),'all_frames_at_least_099':all(x>=.99 for x in scores),'note':'SSIM is a defined image metric, not a universal percentage of perceptual likeness. Downscaled analysis is preliminary; native-resolution verification is required for final acceptance.','per_frame':rows}
(out/'metrics.json').write_text(json.dumps(summary,indent=2))
worst=sorted(rows,key=lambda r:r['ssim'])[:12]
canvas=Image.new('RGB',(1080,12*292),'#151515');draw=ImageDraw.Draw(canvas)
video=cv2.VideoCapture(str(source))
for j,row in enumerate(worst):
    i=row['frame']-1;video.set(cv2.CAP_PROP_POS_FRAMES,i);ok,a=video.read();a=cv2.resize(a,(360,270),interpolation=cv2.INTER_AREA);b=replica_frame(i,seek=True);b=cv2.resize(b,(360,270),interpolation=cv2.INTER_AREA);d=cv2.absdiff(a,b);d=np.minimum(d.astype(float)*3,255).astype(np.uint8)
    for k,img in enumerate([a,b,d]):canvas.paste(Image.fromarray(cv2.cvtColor(img,cv2.COLOR_BGR2RGB)),(k*360,j*292+22))
    draw.text((8,j*292+5),f"Frame {i+1} | source / reconstruction / difference x3 | SSIM {row['ssim']:.5f}",fill='white')
canvas.save(out/'largest-mismatches.jpg',quality=91)
video.release()
if render_video is not None: render_video.release()
print(json.dumps({k:v for k,v in summary.items() if k!='per_frame'},indent=2))
