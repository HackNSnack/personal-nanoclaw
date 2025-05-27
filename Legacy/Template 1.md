---
created: <% tp.file.creation_date() %>
---
tags:: [[+Daily Notes]]

# <% moment(tp.file.title,'YYYY-MM-DD').format("dddd, MMMM DD, YYYY") %>

<< [[Personal Dev/Daily Tracker/<% tp.date.now("YYYY", -1) %>/<% tp.date.now("MM-MMMM", -1) %>/<% tp.date.now("YYYY-MM-DD-dddd", -1) %>|Yesterday]] | [[Personal Dev/Daily Tracker/<% tp.date.now("YYYY", 1) %>/<% tp.date.now("MM-MMMM", 1) %>/<% tp.date.now("YYYY-MM-DD-dddd", 1) %>|Tomorrow]] >>

---
### ❇️ Daily Tasks

##### 🚀 One+ thing I plan to accomplish today is...
- [ ] - <% tp.file.cursor() %>

##### 🌜 Last night, after work, I...
- 

##### 🙌 One thing I'm excited about right now is...
- 



##### 👎 One thing I'm struggling with today is...
- 

---
# 📝 Notes

---
### Notes created today
```dataview
List FROM "" WHERE file.cday = date("<%tp.date.now("YYYY-MM-DD")%>") SORT file.ctime asc
```

### Notes last touched today
```dataview
List FROM "" WHERE file.mday = date("<%tp.date.now("YYYY-MM-DD")%>") SORT file.mtime asc
```