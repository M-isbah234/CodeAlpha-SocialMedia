"""
Seed Orbit with demo data: users (with avatars), posts (some with images),
follows, likes, comments, and a few direct messages.

Run from the backend/ directory:
    ./.venv/Scripts/python.exe seed_demo.py

Idempotent: existing users are reused; their posts are only seeded once.
"""
import io
import os

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth.models import User          # noqa: E402
from django.core.files.base import ContentFile        # noqa: E402
from PIL import Image, ImageDraw, ImageFont            # noqa: E402

from api.models import Comment, Follow, Like, Message, Post  # noqa: E402

PASSWORD = 'Orbit12345'

# Theme-friendly avatar colours (teal / yellow / warm accents).
COLORS = {
    'maya_r': (12, 98, 98),
    'liam_k': (245, 185, 66),
    'zoe_p': (229, 104, 75),
    'noah_s': (58, 134, 200),
    'aria_j': (142, 90, 168),
    'demo':   (42, 157, 143),
}


def _font(size):
    for path in (r'C:\Windows\Fonts\arialbd.ttf', r'C:\Windows\Fonts\arial.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_avatar(initial, color):
    """A square colour tile with a centred initial (CSS crops it to a circle)."""
    size = 256
    img = Image.new('RGB', (size, size), color)
    draw = ImageDraw.Draw(img)
    font = _font(140)
    letter = initial.upper()
    box = draw.textbbox((0, 0), letter, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), letter,
              fill=(255, 255, 255), font=font)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def make_post_image(text, color):
    """A simple 800x500 banner used for a few image posts."""
    w, h = 800, 500
    img = Image.new('RGB', (w, h), color)
    draw = ImageDraw.Draw(img)
    # soft darker footer band
    draw.rectangle([0, h - 90, w, h], fill=tuple(max(0, c - 30) for c in color))
    font = _font(56)
    box = draw.textbbox((0, 0), text, font=font)
    tw = box[2] - box[0]
    draw.text(((w - tw) / 2 - box[0], h / 2 - 40), text, fill=(255, 255, 255), font=font)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()


def ensure_user(username, bio):
    user, created = User.objects.get_or_create(username=username)
    if created:
        user.set_password(PASSWORD)
        user.save()
    profile = user.profile  # auto-created by signal
    changed = False
    if bio and profile.bio != bio:
        profile.bio = bio
        changed = True
    if not profile.avatar:
        profile.avatar.save(f'{username}.png',
                            ContentFile(make_avatar(username[0], COLORS.get(username, (12, 98, 98)))),
                            save=False)
        changed = True
    if changed:
        profile.save()
    return user, created


DEMO = [
    ('maya_r', 'Coffee, code, and cats \u2615', [
        ('Shipped my first Django API today and it actually works on the first try. Small wins!', True),
        ('Hot take: tabs vs spaces doesn\u2019t matter as much as writing tests.', False),
    ]),
    ('liam_k', 'Photographer \U0001F4F7 chasing good light', [
        ('Golden hour by the harbour never disappoints.', True),
        ('New lens day. Everything is a subject again.', False),
    ]),
    ('zoe_p', 'Runner. Reader. Occasional poet.', [
        ('10k before breakfast. The city is so quiet at 6am.', False),
        ('Currently reading three books at once and finishing none of them.', False),
    ]),
    ('noah_s', 'Building things on the web.', [
        ('Refactored a 400-line function into something I\u2019m not embarrassed by.', False),
        ('Teal + yellow is a criminally underrated colour combo.', True),
    ]),
    ('aria_j', 'Designer with a soft spot for teal.', [
        ('Spent the afternoon on a design system. Consistency is a feature.', False),
    ]),
]

POST_IMG_COLORS = {
    'maya_r': (12, 98, 98),
    'liam_k': (245, 185, 66),
    'noah_s': (58, 134, 200),
}

print('Seeding users...')
users = {}
for username, bio, _ in DEMO:
    users[username], _ = ensure_user(username, bio)

# A demo login account so anyone can jump straight in.
users['demo'], _ = ensure_user('demo', 'The friendly demo account. Log in as demo / Orbit12345.')

print('Seeding posts...')
for username, _, posts in DEMO:
    author = users[username]
    if author.posts.exists():
        continue  # already seeded this user's posts
    for content, with_image in posts:
        post = Post(author=author, content=content)
        if with_image:
            post.image.save(f'{username}_seed.png',
                            ContentFile(make_post_image(username, POST_IMG_COLORS.get(username, (12, 98, 98)))),
                            save=False)
        post.save()

print('Seeding follows...')
follow_pairs = [
    ('maya_r', 'liam_k'), ('maya_r', 'zoe_p'), ('liam_k', 'maya_r'),
    ('zoe_p', 'noah_s'), ('noah_s', 'aria_j'), ('aria_j', 'maya_r'),
    ('liam_k', 'noah_s'), ('zoe_p', 'aria_j'),
    # demo follows a few so its Feed is populated
    ('demo', 'maya_r'), ('demo', 'liam_k'), ('demo', 'noah_s'),
    # and a couple follow demo back
    ('maya_r', 'demo'), ('zoe_p', 'demo'),
]
for a, b in follow_pairs:
    Follow.objects.get_or_create(follower=users[a], following=users[b])

print('Seeding likes & comments...')
maya_posts = list(users['maya_r'].posts.all())
if maya_posts:
    target = maya_posts[0]
    for liker in ('liam_k', 'zoe_p', 'noah_s'):
        Like.objects.get_or_create(user=users[liker], post=target)
    if not target.comments.exists():
        Comment.objects.create(post=target, author=users['liam_k'], content='Congrats! That first-try feeling is the best.')
        Comment.objects.create(post=target, author=users['zoe_p'], content='Love this \U0001F389')

print('Seeding direct messages...')
if not Message.objects.filter(sender=users['maya_r'], recipient=users['demo']).exists():
    Message.objects.create(sender=users['maya_r'], recipient=users['demo'], content='Hey! Welcome to Orbit \U0001F44B')
    Message.objects.create(sender=users['demo'], recipient=users['maya_r'], content='Thanks Maya! Loving the teal.')
    Message.objects.create(sender=users['maya_r'], recipient=users['demo'], content='Right? Ping me if you build anything cool.')
if not Message.objects.filter(sender=users['noah_s'], recipient=users['demo']).exists():
    Message.objects.create(sender=users['noah_s'], recipient=users['demo'], content='Saw you followed me — what are you working on?')

print('\nDone. Demo users (password: {}):'.format(PASSWORD))
for u in ('demo', 'maya_r', 'liam_k', 'zoe_p', 'noah_s', 'aria_j'):
    usr = users[u]
    print(f'  - {u:8s}  posts={usr.posts.count()}  followers={usr.followers.count()}')
