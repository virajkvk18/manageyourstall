from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
root=Path(__file__).parent/'dist'
img=Image.new('RGB',(512,512),'#FFDD35')
d=ImageDraw.Draw(img)
points=[(65,189),(148,177),(152,98),(227,159),(311,79),(323,173),(428,185),(362,260),(431,361),(325,349),(288,442),(224,367),(113,395),(129,294),(65,245)]
d.polygon(points, fill='#FF4D87',outline='#171717',width=12)
font=ImageFont.truetype('C:/Windows/Fonts/arialbi.ttf',142)
d.text((254,253),'PP!',font=font,anchor='mm',fill='#FFF9ED',stroke_width=5,stroke_fill='#171717')
for n in [192,512]:img.resize((n,n),Image.Resampling.LANCZOS).save(root/f'icon-{n}.png')
